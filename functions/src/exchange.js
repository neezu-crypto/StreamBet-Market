const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, assertNotBanned } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountDay, kstDateKey, addDailyExchangeAmount } = require('./lib/wallet');
const {
  EXCHANGE_FEE_RATE,
  EXCHANGE_RATE,
  EXCHANGE_STEP,
  EXCHANGE_DAILY_CAPS,
} = require('./constants');

// 주식시장 users/{uid}/cash 잔액 조정 (같은 프로젝트, 다른 최상위 노드) — adjustBalance와
// 동일한 이유로 ref.transaction() 대신 ServerValue.increment 기반 원자적 증감을 쓴다.
async function adjustCash(uid, delta) {
  const ref = getDatabase().ref('users/' + uid + '/cash');
  await ref.set(ServerValue.increment(delta));
  const snap = await ref.get();
  const cash = snap.val() || 0;
  if (cash < 0) {
    await ref.set(ServerValue.increment(-delta)); // 되돌리기
    const err = new Error('주식시장 잔액이 부족합니다.');
    err.code = 'insufficient-cash';
    throw err;
  }
  return cash;
}

function dailyCapForDay(day) {
  if (day <= 1) return EXCHANGE_DAILY_CAPS[0];
  if (day === 2) return EXCHANGE_DAILY_CAPS[1];
  return EXCHANGE_DAILY_CAPS[2];
}

// 07번 — 환전 (배팅시장 ↔ 주식시장, 항상 요청자 본인 uid 기준)
// 익명 세션은 그대로 막되(반복 생성해 실캐시를 무한정 찍어내는 어뷰징 경로 방지),
// 인증 스트리머는 로그인 없이도 환전까지 포함해 실계정과 동일하게 이용할 수 있어야 한다
// (스트리머 인증 제도의 목적 — 로그인을 꺼리는 스트리머도 검수만 통과하면 완전히 동일하게 사용).
const exchangeCurrency = onCall(async (request) => {
  const uid = requireAuth(request);
  if (!(await isTrustedAccount(request))) {
    throw new HttpsError('permission-denied', '환전은 로그인 계정 또는 인증 스트리머만 이용할 수 있습니다. Google 로그인 후 다시 시도해 주세요.');
  }
  await assertNotBanned(uid);
  const { direction, amount } = request.data || {};
  const amt = Number(amount);
  if (!['toStock', 'toBettingMarket'].includes(direction) || !Number.isFinite(amt) || amt <= 0 || amt % EXCHANGE_STEP !== 0) {
    throw new HttpsError('invalid-argument', '환전 금액은 10,000원 단위로 입력해 주세요.');
  }

  const wallet = await ensureWallet(uid);

  const today = kstDateKey();
  const dailyUsedBefore = wallet.dailyExchangeDate === today ? wallet.dailyExchangeTotal || 0 : 0;
  const cap = dailyCapForDay(accountDay(wallet));

  // 한도 예약을 먼저 원자적으로 확정한 뒤에 실제 잔액을 옮긴다 — 그래야 동시 요청이 와도
  // 트랜잭션 자체가 한도 내에서만 성공해서 우회할 수 없다. 예약 후 잔액 이동이 실패하면
  // (예: 반대쪽 잔액 부족) 예약분을 되돌린다.
  try {
    await addDailyExchangeAmount(uid, amt, cap);
  } catch (err) {
    if (err.code === 'daily-cap-exceeded') {
      const remaining = Math.max(cap - (err.actualTotal != null ? err.actualTotal : dailyUsedBefore), 0);
      throw new HttpsError('failed-precondition', '오늘 남은 환전 한도(' + remaining.toLocaleString('ko-KR') + '원)를 초과했습니다.');
    }
    throw err;
  }

  const fee = Math.round(amt * EXCHANGE_FEE_RATE);
  const net = Math.round((amt - fee) * EXCHANGE_RATE);

  try {
    if (direction === 'toStock') {
      await adjustBalance(uid, -amt);
      await adjustCash(uid, net);
    } else {
      await adjustCash(uid, -amt);
      await adjustBalance(uid, net);
    }
  } catch (err) {
    await addDailyExchangeAmount(uid, -amt, null).catch(() => {}); // 예약분 롤백 (최선 노력)
    throw err;
  }

  const now = Date.now();
  const logRef = getDatabase().ref('bettingMarket/exchanges/' + uid).push();
  await logRef.set({ direction, amount: amt, fee, resultAmount: net, requestedAt: now });

  // 13번 — 자산 랭킹에 영향을 주는 잔액 변경이므로 이 시점에만 랭킹 재계산
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('exchangeCurrency');

  return { fee, resultAmount: net };
});

module.exports = { exchangeCurrency };
