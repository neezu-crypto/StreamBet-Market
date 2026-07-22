const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireRealAccount, requireAdmin } = require('./lib/auth');
const { adjustBalance, ensureWallet, accountAgeMs, walletRef } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const { NICKNAME_FORBIDDEN_RE, NEW_ACCOUNT_WAIT_MS } = require('./constants');

const CHARGE_REQUEST_COOLDOWN_MS = 60 * 1000; // 매크로 방지 — 계정당 신청 간 최소 1분

// 자산 충전 신청 — 개발자 라이브 방송 후원 시 룰렛 결과에 따라 자산을 받을 수 있고,
// 이 함수는 그 신청(닉네임 접수)만 받는다. 실제 지급은 관리자가 방송에서 후원·룰렛
// 결과를 직접 확인한 뒤 지급액을 입력해 처리한다(grantChargeRequest).
const submitChargeRequest = onCall(async (request) => {
  const uid = requireRealAccount(request);
  const nickname = (request.data && request.data.nickname || '').trim();
  if (!nickname) throw new HttpsError('invalid-argument', '닉네임을 입력해 주세요.');
  if (nickname.length > 20) throw new HttpsError('invalid-argument', '닉네임은 20자 이하로 입력해 주세요.');
  if (NICKNAME_FORBIDDEN_RE.test(nickname)) {
    throw new HttpsError('invalid-argument', '닉네임에 사용할 수 없는 문자가 포함되어 있습니다.');
  }

  const wallet = await ensureWallet(uid);
  if (accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
    throw new HttpsError('failed-precondition', '신규 계정은 생성 후 1분이 지나야 신청할 수 있습니다.');
  }
  const sinceLast = Date.now() - (wallet.lastChargeRequestAt || 0);
  if (sinceLast < CHARGE_REQUEST_COOLDOWN_MS) {
    throw new HttpsError('failed-precondition', '충전 신청은 계정당 쿨다운(1분) 중에는 할 수 없습니다.');
  }

  const ref = getDatabase().ref('bettingMarket/chargeRequests').push();
  await ref.set({ nickname, uid, requestedAt: Date.now() });
  await walletRef(uid).update({ lastChargeRequestAt: Date.now() });
  return { requestId: ref.key };
});

// 관리자 전용 — 방송에서 후원·룰렛 결과를 확인한 뒤 지급액을 직접 입력해 지급
const grantChargeRequest = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId, amount } = request.data || {};
  const amt = Number(amount);
  if (!requestId || !Number.isFinite(amt) || amt <= 0) {
    throw new HttpsError('invalid-argument', '지급액을 올바르게 입력해 주세요.');
  }

  const db = getDatabase();
  const reqRef = db.ref('bettingMarket/chargeRequests/' + requestId);
  const snap = await reqRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', '신청 내역을 찾을 수 없습니다.');
  const req = snap.val();

  await ensureWallet(req.uid);
  await adjustBalance(req.uid, amt);
  await reqRef.remove();
  await logAudit(adminUid, adminName, '자산 충전 지급', req.nickname + ' · +' + amt.toLocaleString('ko-KR') + '원');

  return { status: 'granted', amount: amt };
});

const dismissChargeRequest = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const reqRef = getDatabase().ref('bettingMarket/chargeRequests/' + requestId);
  const snap = await reqRef.get();
  const req = snap.val();
  await reqRef.remove();
  await logAudit(adminUid, adminName, '자산 충전 신청 무시', req ? req.nickname : requestId);
  return { status: 'dismissed' };
});

module.exports = { submitChargeRequest, grantChargeRequest, dismissChargeRequest };
