const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isRealAccount, assertNotBanned } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountAgeMs, accountDay, setLastBetActionAt } = require('./lib/wallet');
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

async function adjustPool(marketId, outcomeId, delta) {
  const ref = getDatabase().ref('bettingMarket/markets/' + marketId);
  const result = await ref.transaction((market) => {
    if (!market) return market;
    market.totalPool = (market.totalPool || 0) + delta;
    if (!market.outcomes || !market.outcomes[outcomeId]) return; // abort — invalid outcome
    market.outcomes[outcomeId].pool = (market.outcomes[outcomeId].pool || 0) + delta;
    return market;
  });
  if (!result.committed) {
    throw new HttpsError('invalid-argument', '유효하지 않은 outcome입니다.');
  }
  return result.snapshot.val();
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
  if (!isRealAccount(request) && accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
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
  if (!isRealAccount(request) && sinceLast < BET_CANCEL_COOLDOWN_MS) {
    throw new HttpsError('failed-precondition', '취소 · 재배팅은 30초 쿨다운 중에는 할 수 없습니다.');
  }

  await adjustBalance(uid, bet.amount);
  await betRef.update({ status: 'cancelled' });
  await adjustPool(marketId, bet.outcomeId, -bet.amount);
  await setLastBetActionAt(uid, Date.now());

  return { status: 'cancelled' };
});

module.exports = { placeBet, cancelBet };
