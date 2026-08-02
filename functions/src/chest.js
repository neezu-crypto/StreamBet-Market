const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth, requireAdmin, assertNotBanned } = require('./lib/auth');
const { adjustBalance, ensureWallet } = require('./lib/wallet');
const { trimToLast } = require('./lib/capped-log');
const { logAudit } = require('./lib/audit');
const {
  NICKNAME_FORBIDDEN_RE,
  CHEST_PRICE_PER_UNIT,
  CHEST_BONUS_THRESHOLD,
  CHEST_BONUS_RATE,
  CHEST_PRIZE_LOW,
  CHEST_PRIZE_HIGH,
  CHEST_PRIZE_HIGH_CHANCE,
  CHEST_OPEN_LOG_CAP,
  CHEST_MAX_PURCHASE_QTY,
} = require('./constants');

// 자산충전 — 보물상자. 결제(SOOP 후원창, 별풍선)는 외부에서 이뤄지므로 이 함수는
// "신청 기록"만 남기고, 실제 지급은 관리자가 후원을 직접 확인한 뒤 승인해야 이뤄진다
// (기존 라이브 후원+룰렛 방식의 submitChargeRequest/grantChargeRequest를 대체).
const submitChestPurchase = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { nickname, qty } = request.data || {};
  const trimmedNickname = (nickname || '').trim();
  if (!trimmedNickname) throw new HttpsError('invalid-argument', '닉네임을 입력해 주세요.');
  if (trimmedNickname.length > 20) throw new HttpsError('invalid-argument', '닉네임은 20자 이하로 입력해 주세요.');
  if (NICKNAME_FORBIDDEN_RE.test(trimmedNickname)) {
    throw new HttpsError('invalid-argument', '닉네임에 사용할 수 없는 문자가 포함되어 있습니다.');
  }
  const qtyNum = Number(qty);
  if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > CHEST_MAX_PURCHASE_QTY) {
    throw new HttpsError('invalid-argument', '구매 개수를 올바르게 입력해 주세요.');
  }

  const bonusQty = qtyNum >= CHEST_BONUS_THRESHOLD ? Math.floor(qtyNum * CHEST_BONUS_RATE) : 0;
  const totalQty = qtyNum + bonusQty;
  const totalBalloons = qtyNum * CHEST_PRICE_PER_UNIT;

  await ensureWallet(uid);
  const ref = getDatabase().ref('bettingMarket/chestPurchaseRequests').push();
  await ref.set({
    uid,
    nickname: trimmedNickname,
    qty: qtyNum,
    bonusQty,
    totalQty,
    totalBalloons,
    requestedAt: Date.now(),
  });
  return { requestId: ref.key, totalQty, totalBalloons };
});

// 관리자 전용 — 실제 별풍선 후원을 확인한 뒤에만 승인. 승인되면 해당 유저에게
// 보물상자(qty + 보너스)가 지급된다.
const approveChestPurchase = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const db = getDatabase();
  const reqRef = db.ref('bettingMarket/chestPurchaseRequests/' + requestId);

  // 지급 전에 신청 건을 원자적으로 한 번만 선점 — 다른 승인 함수들과 동일하게
  // ref.transaction() 대신 ServerValue.increment 기반 클레임 카운터를 쓴다
  // (firebase-admin의 .transaction() false-null 오작동을 피하기 위함, 07번 환전
  // 버그 조사에서 확인된 패턴).
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists()) throw new HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
  const reqData = reqSnap.val();

  await reqRef.child('claim').set(ServerValue.increment(1));
  const claimSnap = await reqRef.child('claim').get();
  if (claimSnap.val() !== 1) throw new HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
  await reqRef.remove();

  await ensureWallet(reqData.uid);
  await db.ref('bettingMarket/ownedChests/' + reqData.uid).set(ServerValue.increment(reqData.totalQty));
  await logAudit(
    adminUid, adminName, '보물상자 구매 승인',
    reqData.nickname + ' · ' + reqData.qty + '개(+보너스 ' + reqData.bonusQty + ') 지급'
  );

  return { status: 'approved' };
});

const dismissChestPurchase = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const reqRef = getDatabase().ref('bettingMarket/chestPurchaseRequests/' + requestId);
  const snap = await reqRef.get();
  const reqData = snap.val();
  await reqRef.remove();
  await logAudit(adminUid, adminName, '보물상자 구매 신청 무시', reqData ? reqData.nickname : requestId);
  return { status: 'dismissed' };
});

// 보물상자 열기 — 1개 소모, 95% 확률로 50만원 / 5% 확률로 500만원 지급
const openChest = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const db = getDatabase();
  const ownedRef = db.ref('bettingMarket/ownedChests/' + uid);

  await ownedRef.set(ServerValue.increment(-1));
  const snap = await ownedRef.get();
  const remaining = snap.val() || 0;
  if (remaining < 0) {
    await ownedRef.set(ServerValue.increment(1)); // 롤백
    throw new HttpsError('failed-precondition', '보유한 보물상자가 없습니다.');
  }

  const prize = Math.random() < CHEST_PRIZE_HIGH_CHANCE ? CHEST_PRIZE_HIGH : CHEST_PRIZE_LOW;
  await ensureWallet(uid);
  await adjustBalance(uid, prize);

  const profileSnap = await db.ref('bettingMarket/profiles/' + uid + '/nickname').get();
  const nickname = profileSnap.val() || request.auth.token.name || request.auth.token.email || uid;
  const logRef = db.ref('bettingMarket/chestOpenLog');
  await logRef.push({ uid, nickname, prize, openedAt: Date.now() });
  await trimToLast(logRef, CHEST_OPEN_LOG_CAP);

  return { prize, remaining };
});

module.exports = { submitChestPurchase, approveChestPurchase, dismissChestPurchase, openChest };
