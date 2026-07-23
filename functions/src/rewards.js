const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, assertNotBanned } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountAgeMs, kstDateKey, walletRef } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const {
  ATTENDANCE_SCHEDULE,
  NEW_ACCOUNT_WAIT_MS,
  PROPOSAL_REWARD_BASE,
  PROPOSAL_REWARD_PER_PARTICIPANT,
  PROPOSAL_REWARD_CAP,
  PROPOSAL_REWARD_DAILY_MAX,
  JACKPOT_WIN_CHANCE,
} = require('./constants');

const DAY_MS = 24 * 60 * 60 * 1000;

// 12번 — 출석 보상 (7일 주기 스트릭, 결석 시 1일차로 초기화, KST 자정 리셋)
const claimAttendance = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const wallet = await ensureWallet(uid);
  if (!(await isTrustedAccount(request)) && accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
    throw new HttpsError('failed-precondition', '신규 계정은 생성 후 1분이 지나야 출석 보상을 받을 수 있습니다.');
  }

  const today = kstDateKey();
  if (wallet.lastAttendanceDate === today) {
    throw new HttpsError('failed-precondition', '오늘은 이미 출석 보상을 받았습니다.');
  }
  const yesterday = kstDateKey(new Date(Date.now() - DAY_MS));
  const streak = wallet.lastAttendanceDate === yesterday ? (wallet.attendanceStreak || 0) + 1 : 1;
  const reward = ATTENDANCE_SCHEDULE[(streak - 1) % ATTENDANCE_SCHEDULE.length];

  await adjustBalance(uid, reward);
  await walletRef(uid).update({ attendanceStreak: streak, lastAttendanceDate: today });

  // 13번 — 자산 랭킹에 영향을 주는 잔액 변경이므로 이 시점에만 랭킹 재계산
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('claimAttendance');

  return { reward, streak };
});

// 12번 — 주제 제안 흥행 보상. judgeMarket 정산 완료 후 내부적으로 호출된다 (onCall 아님).
async function payoutProposalReward(proposerUid, participantCount) {
  const wallet = await ensureWallet(proposerUid);
  const today = kstDateKey();
  const countToday = wallet.proposalRewardDate === today ? wallet.proposalRewardCount || 0 : 0;
  if (countToday >= PROPOSAL_REWARD_DAILY_MAX) return null; // 1일 3건 상한 (스팸 방지)

  const reward = Math.min(
    PROPOSAL_REWARD_BASE + participantCount * PROPOSAL_REWARD_PER_PARTICIPANT,
    PROPOSAL_REWARD_CAP
  );
  await adjustBalance(proposerUid, reward);
  await walletRef(proposerUid).update({ proposalRewardDate: today, proposalRewardCount: countToday + 1 });
  return reward;
}

// 14번 — 잭팟 당첨 확인. 1인당 1일 1회, 그날 배팅에 1회 이상 참여한 계정만 가능.
// 확률(1/50)은 시도할 때마다 소모되고(꽝이어도 당일 재시도 불가), 당첨되면 적립금 전액을
// 지급하고 즉시 0으로 리셋한다. 동시 요청 대비 잔액 확인·리셋은 트랜잭션으로 원자적으로 처리.
const claimJackpotDraw = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const wallet = await ensureWallet(uid);
  const today = kstDateKey();

  if (wallet.dailyBetDate !== today) {
    throw new HttpsError('failed-precondition', '오늘 배팅에 1회 이상 참여해야 잭팟을 확인할 수 있습니다.');
  }
  if (wallet.lastJackpotDrawDate === today) {
    throw new HttpsError('failed-precondition', '오늘은 이미 잭팟을 확인했습니다. 내일 다시 시도해 주세요.');
  }

  await walletRef(uid).update({ lastJackpotDrawDate: today });

  const won = Math.random() < JACKPOT_WIN_CHANCE;
  if (!won) return { won: false };

  let paidAmount = 0;
  const result = await getDatabase().ref('bettingMarket/jackpot/balance').transaction((bal) => {
    if (!bal || bal <= 0) { paidAmount = 0; return bal; }
    paidAmount = bal;
    return 0;
  });
  if (!result.committed || paidAmount <= 0) {
    return { won: true, amount: 0 };
  }

  await adjustBalance(uid, paidAmount);
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await logAudit(uid, actorName, '잭팟 당첨', paidAmount.toLocaleString('ko-KR') + '원');
  // 지난 당첨 내역 화면에 표시할 전용 로그 (닉네임·아바타는 프로필 노드와 조인해서 프론트에서 표시)
  await getDatabase().ref('bettingMarket/jackpotWins').push({ uid, amount: paidAmount, at: Date.now() });

  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('claimJackpotDraw');

  return { won: true, amount: paidAmount };
});

module.exports = { claimAttendance, payoutProposalReward, claimJackpotDraw };
