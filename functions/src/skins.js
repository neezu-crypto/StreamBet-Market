const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth, assertNotBanned } = require('./lib/auth');
const { adjustBalance } = require('./lib/wallet');
const { trimToLast } = require('./lib/capped-log');
const { SKIN_CATALOG, SKIN_PURCHASE_LOG_CAP } = require('./constants');

// 16번 — 스킨 구매. 보유 여부 선점(트랜잭션)을 먼저 확정한 뒤 결제해야, 동시에 두 번
// 구매 요청이 들어와도 이중 결제 없이 딱 한 번만 성공한다(cancelBet 등과 동일한 패턴).
// 결제(잔액 부족 등)가 실패하면 선점을 롤백한다.
const purchaseSkin = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { skinId } = request.data || {};
  const skin = SKIN_CATALOG[skinId];
  if (!skin) throw new HttpsError('invalid-argument', '존재하지 않는 스킨입니다.');

  const db = getDatabase();
  const ownedRef = db.ref('bettingMarket/ownedSkins/' + uid + '/' + skinId);
  // ref.transaction()이 이 경로에서 실제 값이 있는데도 간헐적으로 current를 null로 잘못
  // 인식하는 현상이 확인돼(07번 환전 버그 조사), ServerValue.increment 기반 클레임
  // 카운터로 선점 여부를 판단하는 방식으로 대체했다.
  const claimRef = db.ref('bettingMarket/skinClaims/' + uid + '/' + skinId);
  await claimRef.set(ServerValue.increment(1));
  const claimSnap = await claimRef.get();
  if (claimSnap.val() !== 1) {
    throw new HttpsError('failed-precondition', '이미 보유한 스킨입니다.');
  }
  await ownedRef.set(true);

  try {
    await adjustBalance(uid, -skin.price);
  } catch (err) {
    await ownedRef.remove().catch(() => {}); // 결제 실패 시 선점 롤백
    await claimRef.set(ServerValue.increment(-1)).catch(() => {}); // 클레임도 되돌려 재시도 가능하게
    throw err;
  }

  const profileSnap = await db.ref('bettingMarket/profiles/' + uid + '/nickname').get();
  const nickname = profileSnap.val() || request.auth.token.name || request.auth.token.email || uid;

  const logRef = db.ref('bettingMarket/skinPurchases');
  await logRef.push({ uid, nickname, skinId, skinName: skin.name, price: skin.price, purchasedAt: Date.now() });
  await trimToLast(logRef, SKIN_PURCHASE_LOG_CAP);

  return { status: 'purchased' };
});

// 16번 — 테마 스킨 장착 · 해제. 카테고리당 장착 가능한 스킨은 1개뿐이라 필드 하나로 관리한다.
// skinId를 비워서 보내면 기본 테마로 해제한다.
const equipSkin = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { skinId } = request.data || {};
  const db = getDatabase();
  const equippedRef = db.ref('bettingMarket/equippedSkin/' + uid);

  if (!skinId) {
    await equippedRef.remove();
    return { status: 'unequipped' };
  }

  if (!SKIN_CATALOG[skinId]) throw new HttpsError('invalid-argument', '존재하지 않는 스킨입니다.');
  const ownedSnap = await db.ref('bettingMarket/ownedSkins/' + uid + '/' + skinId).get();
  if (!ownedSnap.exists()) throw new HttpsError('permission-denied', '보유하지 않은 스킨입니다.');

  await equippedRef.set(skinId);
  return { status: 'equipped' };
});

module.exports = { purchaseSkin, equipSkin };
