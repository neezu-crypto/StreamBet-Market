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

// 07번 환전 일일 누적 사용액 — 서버가 자체 기록으로 검증, 클라이언트 값 불신
async function addDailyExchangeAmount(uid, amount) {
  const ref = walletRef(uid);
  const today = kstDateKey();
  const result = await ref.transaction((current) => {
    if (!current) return; // 지갑이 반드시 먼저 존재해야 함
    if (current.dailyExchangeDate !== today) {
      current.dailyExchangeDate = today;
      current.dailyExchangeTotal = 0;
    }
    current.dailyExchangeTotal = (current.dailyExchangeTotal || 0) + amount;
    return current;
  });
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
