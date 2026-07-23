const { getDatabase } = require('firebase-admin/database');

const INITIAL_BALANCE = 1000000; // 07번 초기 자산
const DAY_MS = 24 * 60 * 60 * 1000;

function walletRef(uid) {
  return getDatabase().ref('bettingMarket/wallets/' + uid);
}

// KST 자정 기준 날짜 키 (12번 출석 보상, 07번 환전 일일 한도)
function kstDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(date || new Date());
}

async function ensureWallet(uid) {
  const ref = walletRef(uid);
  const result = await ref.transaction((current) => {
    if (current) return current;
    return {
      balance: INITIAL_BALANCE,
      accountCreatedAt: Date.now(),
      dailyBetDate: '',
      dailyExchangeTotal: 0,
      dailyExchangeDate: '',
      lastBetActionAt: 0,
      attendanceStreak: 0,
      lastAttendanceDate: '',
      proposalRewardCount: 0,
      proposalRewardDate: '',
    };
  });
  return result.snapshot.val();
}

async function getWallet(uid) {
  return ensureWallet(uid);
}

function accountAgeMs(wallet) {
  return Date.now() - (wallet.accountCreatedAt || Date.now());
}

// 계정 경과일 (1일차부터 시작)
function accountDay(wallet) {
  return Math.floor(accountAgeMs(wallet) / DAY_MS) + 1;
}

async function adjustBalance(uid, delta) {
  const ref = walletRef(uid);
  const result = await ref.transaction((current) => {
    if (!current) {
      current = { balance: INITIAL_BALANCE, accountCreatedAt: Date.now() };
    }
    const nextBalance = (current.balance || 0) + delta;
    if (nextBalance < 0) return; // 트랜잭션 중단 (잔액 부족)
    current.balance = nextBalance;
    return current;
  });
  if (!result.committed) {
    const err = new Error('잔액이 부족합니다.');
    err.code = 'insufficient-balance';
    throw err;
  }
  return result.snapshot.val();
}

// 07번 환전 일일 누적 사용액 — 서버가 자체 기록으로 검증, 클라이언트 값 불신.
// 한도(cap)를 넘기면 트랜잭션 자체를 중단시켜서, "확인 후 나중에 기록"이 아니라
// "기록 자체가 원자적으로 한도 내에서만 성공"하도록 한다 — 동시 요청으로 한도를
// 우회하는 걸 막기 위함. cap이 null/undefined면 한도 체크 없이 그냥 누적만 한다
// (음수 amount로 예약분을 되돌릴 때 사용).
async function addDailyExchangeAmount(uid, amount, cap) {
  const ref = walletRef(uid);
  const today = kstDateKey();
  const result = await ref.transaction((current) => {
    if (!current) return; // 지갑이 반드시 먼저 존재해야 함 (트랜잭션 중단)
    const prevTotal = current.dailyExchangeDate === today ? (current.dailyExchangeTotal || 0) : 0;
    const nextTotal = prevTotal + amount;
    if (cap != null && nextTotal > cap) return; // 트랜잭션 중단 — 한도 초과
    current.dailyExchangeDate = today;
    current.dailyExchangeTotal = Math.max(0, nextTotal);
    return current;
  });
  if (!result.committed) {
    const err = new Error('오늘 환전 한도를 초과했습니다.');
    err.code = 'daily-cap-exceeded';
    throw err;
  }
  return result.snapshot.val();
}

async function setLastBetActionAt(uid, ts) {
  await walletRef(uid).child('lastBetActionAt').set(ts);
}

module.exports = {
  INITIAL_BALANCE,
  DAY_MS,
  walletRef,
  kstDateKey,
  ensureWallet,
  getWallet,
  accountAgeMs,
  accountDay,
  adjustBalance,
  addDailyExchangeAmount,
  setLastBetActionAt,
};
