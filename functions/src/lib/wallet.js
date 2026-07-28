const { getDatabase, ServerValue } = require('firebase-admin/database');
const { HttpsError } = require('firebase-functions/v2/https');

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

// ensureWallet()이 이미 지갑을 만들어 둔 뒤에만 호출된다는 전제 하에, ref.transaction()이
// 같은 지갑 경로에서 실제 값이 있는데도 간헐적으로 current를 null로 잘못 인식하는 firebase-admin
// 버그(07번 환전 한도 버그 조사로 확인됨)를 피하기 위해 balance 필드만 ServerValue.increment로
// 원자적으로 증감하고, 음수가 되면 되돌리는 방식을 쓴다. transaction()의 "current가 없으면 기본값
// 생성" 폴백은 이 버그 아래에서 실제 잔액을 조용히 초기값으로 덮어쓸 위험이 있어 제거했다.
async function adjustBalance(uid, delta) {
  const ref = walletRef(uid).child('balance');
  await ref.set(ServerValue.increment(delta));
  const snap = await ref.get();
  const balance = snap.val() || 0;
  if (balance < 0) {
    await ref.set(ServerValue.increment(-delta)); // 되돌리기
    // 일반 Error를 던지면 onCall 핸들러가 클라이언트에 메시지를 그대로 안
    // 넘기고 "INTERNAL"로 뭉개버린다(HttpsError만 메시지가 전달됨) — 배팅·
    // 환전·스킨구매 등 adjustBalance를 쓰는 모든 곳에서 겪는 문제라 여기
    // 한 곳에서 HttpsError로 고친다.
    throw new HttpsError('failed-precondition', '잔액이 부족합니다.');
  }
  return { balance };
}

// 07번 환전 일일 누적 사용액 — 서버가 자체 기록으로 검증, 클라이언트 값 불신.
// ref.transaction()이 이 경로에서 실제 값이 있는데도 간헐적으로 current를 null로
// 보는 firebase-admin 버그(진단 결과 .get()은 정상, .transaction()만 null로 인식하는
// 현상 확인됨)를 피하려고, transaction 대신 ServerValue.increment로 원자적 증가 →
// 조회 → 한도 초과 시 보정(되돌리기) 방식을 쓴다. 날짜별 키(dailyExchange/{today})라
// 자정이 지나면 새 키로 자동 분리되어 별도 리셋 로직도 필요 없다.
async function addDailyExchangeAmount(uid, amount, cap) {
  const today = kstDateKey();
  const dayRef = walletRef(uid).child('dailyExchange').child(today);
  await dayRef.set(ServerValue.increment(amount));
  const snap = await dayRef.get();
  const total = snap.val() || 0;
  if (cap != null && total > cap) {
    await dayRef.set(ServerValue.increment(-amount)); // 한도 초과분 되돌리기
    const err = new Error('오늘 환전 한도를 초과했습니다.');
    err.code = 'daily-cap-exceeded';
    err.actualTotal = total - amount; // 되돌리기 전, 이번 요청분 제외한 실제 사용액
    throw err;
  }
  // 화면 표시용 필드 — 한도 판정 자체는 위 dailyExchange/{today} 값 기준이고, 이건 참고용 미러링
  await walletRef(uid).update({ dailyExchangeDate: today, dailyExchangeTotal: total });
  return total;
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
