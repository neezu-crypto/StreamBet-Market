const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, assertNotBanned } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountAgeMs, accountDay, setLastBetActionAt, kstDateKey, walletRef } = require('./lib/wallet');
const {
  BET_STEP,
  BET_MAX_AMOUNT,
  NEW_ACCOUNT_WAIT_MS,
  NEW_ACCOUNT_BET_CAPS,
  BET_CANCEL_COOLDOWN_MS,
} = require('./constants');

function betCapForDay(day) {
  return day <= 1 ? NEW_ACCOUNT_BET_CAPS[0] : NEW_ACCOUNT_BET_CAPS[1];
}

// ref.transaction()이 실제 값이 있는 경로에서도 간헐적으로 current를 null로 잘못 인식하는
// firebase-admin 버그(07번 환전 버그 조사로 확인)를 피하려고, ServerValue.increment 기반
// 원자적 증감으로 바꿨다. 게다가 기존 코드는 market이 없을 때 `return market`으로 null을
// 반환했는데, RTDB 트랜잭션에서 null 반환은 "그 경로를 삭제"로 커밋되는 값이라 이 버그와
// 겹치면 마켓 데이터 자체가 삭제될 위험이 있었다 — outcome 존재 여부를 먼저 일반 조회로
// 확인해 그 위험도 함께 없앤다.
async function adjustPool(marketId, outcomeId, delta) {
  const ref = getDatabase().ref('bettingMarket/markets/' + marketId);
  const outcomeSnap = await ref.child('outcomes').child(outcomeId).get();
  if (!outcomeSnap.exists()) {
    throw new HttpsError('invalid-argument', '유효하지 않은 outcome입니다.');
  }
  await ref.child('totalPool').set(ServerValue.increment(delta));
  await ref.child('outcomes').child(outcomeId).child('pool').set(ServerValue.increment(delta));
}

// 09번 — 배팅 참가. 잔액 차감·쿨다운·한도는 전부 서버(Functions)가 검증한다.
const placeBet = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { marketId, outcomeId, amount } = request.data || {};
  const amt = Number(amount);
  if (!marketId || !outcomeId || !Number.isFinite(amt) || amt <= 0 || amt % BET_STEP !== 0) {
    throw new HttpsError('invalid-argument', '배팅 금액은 10,000원 단위로 입력해 주세요.');
  }

  const wallet = await ensureWallet(uid);
  if (!(await isTrustedAccount(request)) && accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
    throw new HttpsError('failed-precondition', '신규 계정은 생성 후 1분이 지나야 배팅에 참여할 수 있습니다.');
  }
  const cap = Math.min(betCapForDay(accountDay(wallet)), BET_MAX_AMOUNT);
  if (amt > cap) {
    throw new HttpsError('failed-precondition', '1회 최대 배팅 한도(' + cap.toLocaleString('ko-KR') + '원)를 초과했습니다.');
  }

  const marketSnap = await getDatabase().ref('bettingMarket/markets/' + marketId).get();
  if (!marketSnap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = marketSnap.val();
  if (market.status !== 'open') throw new HttpsError('failed-precondition', '지금은 배팅할 수 없는 마켓입니다.');
  if (Date.now() >= market.timing.bettingClosesAt) {
    throw new HttpsError('failed-precondition', '배팅이 마감되었습니다.');
  }
  if (!market.outcomes || !market.outcomes[outcomeId]) {
    throw new HttpsError('invalid-argument', '존재하지 않는 outcome입니다.');
  }

  await adjustBalance(uid, -amt); // 잔액 부족 시 여기서 예외 발생
  const betRef = getDatabase().ref('bettingMarket/bets/' + marketId).push();
  await betRef.set({ uid, outcomeId, amount: amt, status: 'active', placedAt: Date.now() });
  await getDatabase().ref('bettingMarket/userBets/' + uid + '/' + marketId + '/' + betRef.key).set(true);
  await adjustPool(marketId, outcomeId, amt);
  await setLastBetActionAt(uid, Date.now());
  await walletRef(uid).child('dailyBetDate').set(kstDateKey()); // 14번 — 잭팟 확인 참여 자격(당일 배팅 1회 이상) 판정용

  return { betId: betRef.key };
});

// 09번 — 취소 + 재배팅(30초 쿨다운). 취소 자체를 이 함수로 처리하고, 재배팅은 placeBet을 다시 호출한다.
const cancelBet = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { marketId, betId } = request.data || {};
  if (!marketId || !betId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const betRef = getDatabase().ref('bettingMarket/bets/' + marketId + '/' + betId);
  const betSnap = await betRef.get();
  if (!betSnap.exists()) throw new HttpsError('not-found', '배팅 내역을 찾을 수 없습니다.');
  const bet = betSnap.val();
  if (bet.uid !== uid) throw new HttpsError('permission-denied', '본인의 배팅만 취소할 수 있습니다.');
  if (bet.status !== 'active') throw new HttpsError('failed-precondition', '이미 처리된 배팅입니다.');

  const marketSnap = await getDatabase().ref('bettingMarket/markets/' + marketId).get();
  const market = marketSnap.val();
  if (!market || market.status !== 'open' || Date.now() >= market.timing.bettingClosesAt) {
    throw new HttpsError('failed-precondition', '배팅 마감 전까지만 취소할 수 있습니다.');
  }

  const wallet = await ensureWallet(uid);
  const sinceLast = Date.now() - (wallet.lastBetActionAt || 0);
  if (!(await isTrustedAccount(request)) && sinceLast < BET_CANCEL_COOLDOWN_MS) {
    throw new HttpsError('failed-precondition', '취소 · 재배팅은 30초 쿨다운 중에는 할 수 없습니다.');
  }

  // 취소 자체를 원자적으로 한 번만 선점해야 한다 — "active 확인 → 환불 → cancelled 기록"이
  // 분리되어 있으면 동시에 두 번 취소 요청이 와도 둘 다 active로 읽고 통과해 환불이 이중으로
  // 나갈 수 있다. ref.transaction()이 이 경로에서 간헐적으로 오작동하는 현상이 확인돼(07번
  // 환전 버그 조사), ServerValue.increment로 만든 클레임 카운터가 정확히 1이 되는 요청만
  // "선점 성공"으로 인정하는 방식으로 대체한다.
  await betRef.child('cancelClaim').set(ServerValue.increment(1));
  const claimResult = await betRef.child('cancelClaim').get();
  if (claimResult.val() !== 1) {
    throw new HttpsError('failed-precondition', '이미 처리된 배팅입니다.');
  }
  await betRef.update({ status: 'cancelled' });

  await adjustBalance(uid, bet.amount);
  await adjustPool(marketId, bet.outcomeId, -bet.amount);
  await setLastBetActionAt(uid, Date.now());

  return { status: 'cancelled' };
});

module.exports = { placeBet, cancelBet };
