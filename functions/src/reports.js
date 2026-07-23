const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, requireAdminOrVerifiedStreamer, assertNotBanned } = require('./lib/auth');
const { ensureWallet, accountAgeMs, walletRef } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const {
  NEW_ACCOUNT_REPORT_WAIT_MS,
  REPORT_COOLDOWN_MS,
  PROHIBITED_TOPIC_REASONS,
  NICKNAME_REPORT_REASONS,
  NICKNAME_FORBIDDEN_RE,
  NICKNAME_MAX_LENGTH,
  REPORT_DETAIL_MAX_LENGTH,
} = require('./constants');

const ALL_REASONS = PROHIBITED_TOPIC_REASONS.concat(['기타']);

function assertValidDetail(detail) {
  if (detail && detail.length > REPORT_DETAIL_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', '상세 사유는 ' + REPORT_DETAIL_MAX_LENGTH + '자 이하로 입력해 주세요.');
  }
}

async function checkReportGate(uid, wallet) {
  if (accountAgeMs(wallet) < NEW_ACCOUNT_REPORT_WAIT_MS) {
    throw new HttpsError('failed-precondition', '신규 계정은 생성 후 10분이 지나야 신고할 수 있습니다.');
  }
  const sinceLast = Date.now() - (wallet.lastReportAt || 0);
  if (sinceLast < REPORT_COOLDOWN_MS) {
    throw new HttpsError('failed-precondition', '신고 간 쿨다운(5분) 중입니다.');
  }
}

// 04번 — 배팅 주제 신고 (마켓당 1회, 5분 쿨다운, 신규계정 10분 대기)
const reportMarket = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { marketId, reason, detail } = request.data || {};
  if (!marketId || !ALL_REASONS.includes(reason)) {
    throw new HttpsError('invalid-argument', '신고 사유를 선택해 주세요.');
  }
  assertValidDetail(detail);
  const db = getDatabase();
  const marketSnap = await db.ref('bettingMarket/markets/' + marketId).get();
  if (!marketSnap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = marketSnap.val();

  const markRef = db.ref('bettingMarket/marketReportMarks/' + uid + '/' + marketId);
  if ((await markRef.get()).exists()) {
    throw new HttpsError('failed-precondition', '이미 이 마켓을 신고했습니다.');
  }
  const wallet = await ensureWallet(uid);
  if (!(await isTrustedAccount(request))) await checkReportGate(uid, wallet);

  const reportRef = db.ref('bettingMarket/marketReports').push();
  await reportRef.set({
    marketId,
    marketTitle: market.title,
    reason,
    detail: detail || '',
    reporterUid: uid,
    reportedAt: Date.now(),
  });
  await markRef.set(true);
  await walletRef(uid).update({ lastReportAt: Date.now() });
  return { reportId: reportRef.key };
});

// 04번 — 신고 접수함 처리 (관리자·인증 스트리머 모두 가능, "확인 완료"로 종료)
const dismissMarketReport = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const db = getDatabase();
  const ref = db.ref('bettingMarket/marketReports/' + reportId);
  const snap = await ref.get();
  const report = snap.val();
  await ref.remove();
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await logAudit(uid, actorName, '신고 확인 완료', report ? report.marketTitle + ' (' + report.reason + ')' : reportId);
  return { status: 'dismissed', role };
});

// 13번 — 닉네임 신고 (본인 제외, 04번과 동일 원칙)
const reportNickname = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { targetId, nickname, reason, detail } = request.data || {};
  if (!targetId || targetId === uid || !nickname || !NICKNAME_REPORT_REASONS.includes(reason)) {
    throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  }
  if (nickname.length > NICKNAME_MAX_LENGTH || NICKNAME_FORBIDDEN_RE.test(nickname)) {
    throw new HttpsError('invalid-argument', '닉네임 형식이 올바르지 않습니다.');
  }
  assertValidDetail(detail);
  const db = getDatabase();
  const reportRef = db.ref('bettingMarket/nicknameReports').push();
  await reportRef.set({ targetId, nickname, reason, detail: detail || '', reporterUid: uid, reportedAt: Date.now() });
  return { reportId: reportRef.key };
});

// 13번 — 닉네임 신고 접수함 처리 (관리자·인증 스트리머 모두 가능, "무시"로 종료 — 04번의
// dismissMarketReport와 동일 원칙). 예전에는 클라이언트가 이 노드를 직접 지우려 했는데
// 규칙상 write:false라 항상 조용히 실패했었다.
const dismissNicknameReport = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const db = getDatabase();
  const ref = db.ref('bettingMarket/nicknameReports/' + reportId);
  const snap = await ref.get();
  const report = snap.val();
  await ref.remove();
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await logAudit(uid, actorName, '닉네임 신고 무시', report ? report.nickname + ' (' + report.reason + ')' : reportId);
  return { status: 'dismissed', role };
});

// 13번 — 닉네임 차단 (관리자·인증 스트리머), 차단 시 랭킹에서 즉시 숨김
const blockNickname = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { reportId } = request.data || {};
  if (!reportId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const db = getDatabase();
  const reportRef = db.ref('bettingMarket/nicknameReports/' + reportId);
  const snap = await reportRef.get();
  if (!snap.exists()) throw new HttpsError('not-found', '신고 내역을 찾을 수 없습니다.');
  const report = snap.val();
  const actorName = request.auth.token.name || request.auth.token.email || uid;

  await db.ref('bettingMarket/blockedNicknames/' + report.targetId).set({
    nickname: report.nickname,
    blockedAt: Date.now(),
    blockedBy: uid,
    blockedByName: actorName,
  });
  await reportRef.remove();
  await logAudit(uid, actorName, '닉네임 차단', report.nickname + ' (' + report.reason + ')');

  // 13번 — 차단 시 랭킹에서 즉시 제외되어야 하므로 이 시점에만 랭킹 재계산
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('blockNickname');

  return { status: 'blocked' };
});

// 13번 — 차단 해제는 닉네임 변경으로 자동 해제되지 않고, 검수자가 직접 확인 후 수동 해제
const unblockNickname = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { targetId } = request.data || {};
  if (!targetId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const db = getDatabase();
  const ref = db.ref('bettingMarket/blockedNicknames/' + targetId);
  const snap = await ref.get();
  const entry = snap.val();
  await ref.remove();
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await logAudit(uid, actorName, '닉네임 차단 해제', entry ? entry.nickname : targetId);

  // 13번 — 차단 해제 시 다시 랭킹에 노출되어야 하므로 이 시점에만 랭킹 재계산
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('unblockNickname');

  return { status: 'unblocked' };
});

module.exports = { reportMarket, dismissMarketReport, reportNickname, dismissNicknameReport, blockNickname, unblockNickname };
