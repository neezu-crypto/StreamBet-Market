const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireRealAccount } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountAgeMs, accountDay, kstDateKey, walletRef } = require('./lib/wallet');
const {
  EXCHANGE_FEE_RATE,
  EXCHANGE_RATE,
  EXCHANGE_STEP,
  EXCHANGE_COOLDOWN_MS,
  EXCHANGE_DAILY_CAPS,
  NEW_ACCOUNT_WAIT_MS,
} = require('./constants');

// 주식시장 users/{uid}/cash 잔액 조정 (같은 프로젝트, 다른 최상위 노드)
async function adjustCash(uid, delta) {
  const ref = getDatabase().ref('users/' + uid + '/cash');
  const result = await ref.transaction((current) => {
    const next = (current || 0) + delta;
    if (next < 0) return; // 트랜잭션 중단
    return next;
  });
  if (!result.committed) {
    const err = new Error('주식시장 잔액이 부족합니다.');
    err.code = 'insufficient-cash';
    throw err;
  }
  return result.snapshot.val();
}

function dailyCapForDay(day) {
  if (day <= 1) return EXCHANGE_DAILY_CAPS[0];
  if (day === 2) return EXCHANGE_DAILY_CAPS[1];
  return EXCHANGE_DAILY_CAPS[2];
}

// 07번 — 환전 (배팅시장 ↔ 주식시장, 항상 요청자 본인 uid 기준)
const exchangeCurrency = onCall(async (request) => {
  const uid = requireRealAccount(request);
  const { direction, amount } = request.data || {};
  const amt = Number(amount);
  if (!['toStock', 'toBettingMarket'].includes(direction) || !Number.isFinite(amt) || amt <= 0 || amt % EXCHANGE_STEP !== 0) {
    throw new HttpsError('invalid-argument', '환전 금액은 10,000원 단위로 입력해 주세요.');
  }

  const wallet = await ensureWallet(uid);
  if (accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
    throw new HttpsError('failed-precondition', '신규 계정은 생성 후 1분이 지나야 환전할 수 있습니다.');
  }

  const sinceLastExchange = Date.now() - (wallet.lastExchangeAt || 0);
  if (sinceLastExchange < EXCHANGE_COOLDOWN_MS) {
    throw new HttpsError('failed-precondition', '환전은 24시간에 1회만 가능합니다.');
  }

  const today = kstDateKey();
  const dailyUsed = wallet.dailyExchangeDate === today ? wallet.dailyExchangeTotal || 0 : 0;
  const cap = dailyCapForDay(accountDay(wallet));
  if (dailyUsed + amt > cap) {
    throw new HttpsError('failed-precondition', '오늘 남은 환전 한도(' + Math.max(cap - dailyUsed, 0).toLocaleString('ko-KR') + '원)를 초과했습니다.');
  }

  const fee = Math.round(amt * EXCHANGE_FEE_RATE);
  const net = Math.round((amt - fee) * EXCHANGE_RATE);

  if (direction === 'toStock') {
    await adjustBalance(uid, -amt);
    await adjustCash(uid, net);
  } else {
    await adjustCash(uid, -amt);
    await adjustBalance(uid, net);
  }

  const now = Date.now();
  await walletRef(uid).update({
    dailyExchangeDate: today,
    dailyExchangeTotal: dailyUsed + amt,
    lastExchangeAt: now,
  });

  const logRef = getDatabase().ref('bettingMarket/exchanges/' + uid).push();
  await logRef.set({ direction, amount: amt, fee, resultAmount: net, requestedAt: now });

  return { fee, resultAmount: net };
});

module.exports = { exchangeCurrency };
