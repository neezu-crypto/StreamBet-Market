const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, assertNotBanned } = require('./lib/auth');
const { ensureWallet, adjustBalance, accountAgeMs, kstDateKey, walletRef } = require('./lib/wallet');
const {
  ATTENDANCE_SCHEDULE,
  NEW_ACCOUNT_WAIT_MS,
  PROPOSAL_REWARD_BASE,
  PROPOSAL_REWARD_PER_PARTICIPANT,
  PROPOSAL_REWARD_CAP,
  PROPOSAL_REWARD_DAILY_MAX,
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

// 12번 — 잭팟은 지급액이 아직 미정(보류)이므로 구조만 준비한다. 실제 배분 로직은 금액 확정 후 구현.
const distributeJackpotWeekly = onSchedule('every sunday 00:00', async () => {
  // TODO: 잭팟 지급액 정책 확정 전까지는 아무 것도 지급하지 않는다 (14번 — 보류 상태 그대로 유지).
  return null;
});

module.exports = { claimAttendance, payoutProposalReward, distributeJackpotWeekly };
