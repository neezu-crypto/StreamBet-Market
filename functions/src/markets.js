const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const {
  requireAuth,
  isAdminEmail,
  requireAdminOrVerifiedStreamer,
  isVerifiedStreamerUid,
} = require('./lib/auth');
const { adjustBalance, ensureWallet, accountAgeMs, walletRef } = require('./lib/wallet');
const { computeSettlement } = require('./lib/pool');
const { logAudit } = require('./lib/audit');
const {
  RAKE_RATE,
  MIN_PAYOUT_MULTIPLIER,
  BET_MIN_PARTICIPANTS,
  PROHIBITED_TOPIC_REASONS,
  NEW_ACCOUNT_WAIT_MS,
  PROPOSAL_COOLDOWN_MS,
} = require('./constants');

function marketRef(marketId) {
  return getDatabase().ref('bettingMarket/markets/' + marketId);
}
function betsRef(marketId) {
  return getDatabase().ref('bettingMarket/bets/' + marketId);
}

async function refundAllActiveBets(marketId) {
  const snap = await betsRef(marketId).get();
  const bets = snap.val() || {};
  const updates = {};
  const jobs = [];
  Object.keys(bets).forEach((betId) => {
    const bet = bets[betId];
    if (bet.status === 'active') {
      jobs.push(adjustBalance(bet.uid, bet.amount));
      updates[betId + '/status'] = 'refunded';
    }
  });
  await Promise.all(jobs);
  if (Object.keys(updates).length) await betsRef(marketId).update(updates);
}

// 04번/03번 — 배팅 주제 제안 등록. stocks 참조 검증, 관리자·인증 스트리머는 즉시 오픈.
const submitMarketProposal = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  const isPrivileged = isAdminEmail(email) || (await isVerifiedStreamerUid(uid));

  // 매크로 방지 — 관리자·인증 스트리머는 이미 검증 단계를 생략하는 신뢰된 주체라 제외하고(04번과 동일 원칙),
  // 일반 유저에게만 신규 계정 대기 + 계정당 제안 쿨다운을 적용한다.
  let wallet = null;
  if (!isPrivileged) {
    wallet = await ensureWallet(uid);
    if (accountAgeMs(wallet) < NEW_ACCOUNT_WAIT_MS) {
      throw new HttpsError('failed-precondition', '신규 계정은 생성 후 1분이 지나야 배팅 주제를 제안할 수 있습니다.');
    }
    const sinceLast = Date.now() - (wallet.lastProposalAt || 0);
    if (sinceLast < PROPOSAL_COOLDOWN_MS) {
      throw new HttpsError('failed-precondition', '배팅 주제 제안은 계정당 쿨다운(1분) 중에는 할 수 없습니다.');
    }
  }

  const { title, type, streamerIds, betHours, eventHours } = request.data || {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new HttpsError('invalid-argument', '배팅 주제 문구를 입력해 주세요.');
  }
  if (!['personal', '1v1', 'group'].includes(type)) {
    throw new HttpsError('invalid-argument', '대전 유형이 올바르지 않습니다.');
  }
  const ids = Array.isArray(streamerIds) ? [...new Set(streamerIds)] : [];
  if (type === 'personal' && ids.length !== 1) {
    throw new HttpsError('invalid-argument', '개인전은 스트리머 1명을 지정해야 합니다.');
  }
  if (type === '1v1' && ids.length !== 2) {
    throw new HttpsError('invalid-argument', '1vs1은 스트리머 2명을 지정해야 합니다.');
  }
  if (type === 'group' && ids.length < 2) {
    throw new HttpsError('invalid-argument', '단체전은 스트리머 2명 이상을 지정해야 합니다.');
  }
  const betH = Number(betHours);
  const eventH = Number(eventHours);
  if (!Number.isFinite(betH) || betH < 1 || !Number.isFinite(eventH) || eventH < 0) {
    throw new HttpsError('invalid-argument', '배팅 마감 · 이벤트 마감 시간을 확인해 주세요.');
  }

  const db = getDatabase();
  // 05번 — stocks에 실재하는 스트리머인지 서버 검증
  const streamerDocs = await Promise.all(ids.map((id) => db.ref('stocks/' + id).get()));
  const names = {};
  streamerDocs.forEach((snap, i) => {
    if (!snap.exists()) {
      throw new HttpsError('failed-precondition', '등록되지 않은 스트리머가 포함되어 있습니다.');
    }
    names[ids[i]] = (snap.val() || {}).name || ids[i];
  });

  const now = Date.now();
  const bettingClosesAt = now + betH * 3600000;
  const eventEndsAt = bettingClosesAt + eventH * 3600000;

  const outcomes = {};
  if (type === 'personal') {
    outcomes.success = { label: '성공', pool: 0 };
    outcomes.fail = { label: '실패', pool: 0 };
  } else {
    ids.forEach((id) => {
      outcomes[id] = { label: names[id], streamerId: id, pool: 0 };
    });
  }

  const status = isPrivileged ? 'open' : 'pendingValidation';

  const newRef = marketRef('').push();
  const market = {
    type,
    category: 'userProposed',
    title: title.trim(),
    streamerIds: ids,
    outcomes,
    totalPool: 0,
    status,
    proposerUid: uid,
    validation: {
      method: isPrivileged ? 'privileged-auto' : null,
      validatedBy: isPrivileged ? uid : null,
      validatedAt: isPrivileged ? now : null,
      likeCount: 0,
    },
    timing: {
      bettingOpensAt: now,
      bettingClosesAt,
      eventStartsAt: bettingClosesAt,
      eventEndsAt,
    },
    rakeRate: RAKE_RATE,
    minPayoutMultiplier: MIN_PAYOUT_MULTIPLIER,
  };
  await newRef.set(market);
  if (!isPrivileged) {
    await walletRef(uid).update({ lastProposalAt: now });
  }
  return { marketId: newRef.key, status };
});

// 04번 — 검수 화면: 관리자·인증 스트리머의 승인/반려, 추천수·참가자 미달 예외 처리
const reviewProposal = onCall(async (request) => {
  const { uid } = await requireAdminOrVerifiedStreamer(request);
  const { marketId, action, overrideLikes, overrideParticipants } = request.data || {};
  if (!marketId || !['approve', 'reject'].includes(action)) {
    throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  }
  const ref = marketRef(marketId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = snap.val();
  if (market.status !== 'pendingValidation') {
    throw new HttpsError('failed-precondition', '이미 처리된 제안입니다.');
  }

  if (action === 'reject') {
    await ref.update({ status: 'rejected' });
    await logAudit(uid, request.auth.token.name, '검수 반려', market.title);
    return { status: 'rejected' };
  }

  const now = Date.now();
  const updates = {
    status: 'open',
    'validation/method': 'manual',
    'validation/validatedBy': uid,
    'validation/validatedAt': now,
  };
  if (overrideLikes) updates['validation/overrideReason'] = '추천수 미달 강제 승인';
  if (overrideParticipants) updates.minParticipantsOverride = true;
  await ref.update(updates);
  await logAudit(uid, request.auth.token.name, '검수 승인', market.title + (overrideLikes || overrideParticipants ? ' (예외 적용)' : ''));
  return { status: 'open' };
});

// 10번 — 조기 마감 (사유 필수, 처리자 기록)
const closeMarketEarly = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { marketId, reason } = request.data || {};
  if (!marketId || !reason) throw new HttpsError('invalid-argument', '사유를 선택해 주세요.');
  const ref = marketRef(marketId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = snap.val();
  if (!['open', 'pendingValidation'].includes(market.status)) {
    throw new HttpsError('failed-precondition', '이미 마감된 마켓입니다.');
  }
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await ref.update({
    status: 'closed',
    adminAction: { type: 'closeEarly', reason, actorUid: uid, actorName, actorRole: role, at: Date.now() },
    'timing/bettingClosesAt': Date.now(),
  });
  await logAudit(uid, actorName, '조기 마감', market.title + ' — 사유: ' + reason);
  return { status: 'closed' };
});

// 10번 — 무효 처리 (전액 환불, 사유 필수, 처리자 기록)
const voidMarket = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { marketId, reason } = request.data || {};
  if (!marketId || !reason) throw new HttpsError('invalid-argument', '사유를 선택해 주세요.');
  const ref = marketRef(marketId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = snap.val();
  if (['void', 'settled'].includes(market.status)) {
    throw new HttpsError('failed-precondition', '이미 종료된 마켓입니다.');
  }
  const actorName = request.auth.token.name || request.auth.token.email || uid;
  await refundAllActiveBets(marketId);
  await ref.update({
    status: 'void',
    adminAction: { type: 'void', reason, actorUid: uid, actorName, actorRole: role, at: Date.now() },
  });
  await logAudit(uid, actorName, '무효 처리', market.title + ' — 사유: ' + reason);
  return { status: 'void' };
});

// 10번/08번 — 최종 승·패 판정 및 정산·배당 지급
const judgeMarket = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const { marketId, winningOutcomeId } = request.data || {};
  if (!marketId || !winningOutcomeId) {
    throw new HttpsError('invalid-argument', '판정할 outcome을 선택해 주세요.');
  }
  const ref = marketRef(marketId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '마켓을 찾을 수 없습니다.');
  const market = snap.val();
  if (market.status !== 'closed') {
    throw new HttpsError('failed-precondition', '배팅 마감 후에만 판정할 수 있습니다.');
  }
  if (!market.outcomes || !market.outcomes[winningOutcomeId]) {
    throw new HttpsError('invalid-argument', '존재하지 않는 outcome입니다.');
  }

  const betsSnap = await betsRef(marketId).get();
  const bets = betsSnap.val() || {};
  const activeBets = Object.entries(bets).filter(([, b]) => b.status === 'active');
  const uniqueParticipants = new Set(activeBets.map(([, b]) => b.uid));

  // 09번/08번 — 최소 참여자 수 미달 시 무효·환불 (검수 시 예외 처리된 경우 제외)
  if (uniqueParticipants.size < BET_MIN_PARTICIPANTS && !market.minParticipantsOverride) {
    await refundAllActiveBets(marketId);
    await ref.update({
      status: 'void',
      adminAction: {
        type: 'void',
        reason: '최소 참여 인원 미달',
        actorUid: uid,
        actorName: request.auth.token.name || request.auth.token.email || uid,
        actorRole: role,
        at: Date.now(),
      },
    });
    return { status: 'void', reason: 'min-participants' };
  }

  const totalPool = market.totalPool || 0;
  const winningPool = (market.outcomes[winningOutcomeId] || {}).pool || 0;
  const rakeRate = market.rakeRate != null ? market.rakeRate : RAKE_RATE;
  const minPayoutMultiplier = market.minPayoutMultiplier != null ? market.minPayoutMultiplier : MIN_PAYOUT_MULTIPLIER;

  const reserveSnap = await getDatabase().ref('bettingMarket/reserveFund/balance').get();
  const reserveBalance = reserveSnap.val() || 0;

  const result = computeSettlement({ totalPool, winningPool, rakeRate, minPayoutMultiplier, reserveBalance });

  if (result.void) {
    await refundAllActiveBets(marketId);
    await ref.update({
      status: 'void',
      adminAction: {
        type: 'void',
        reason: '이벤트 자체 무산 · 승자 없음',
        actorUid: uid,
        actorName: request.auth.token.name || request.auth.token.email || uid,
        actorRole: role,
        at: Date.now(),
      },
    });
    return { status: 'void', reason: result.reason };
  }

  const betUpdates = {};
  const payoutJobs = [];
  activeBets.forEach(([betId, bet]) => {
    if (bet.outcomeId === winningOutcomeId) {
      const payout = Math.round(bet.amount * result.multiplier);
      payoutJobs.push(adjustBalance(bet.uid, payout));
      betUpdates[betId + '/status'] = 'paid';
      betUpdates[betId + '/payout'] = payout;
    } else {
      betUpdates[betId + '/status'] = 'lost';
    }
  });
  await Promise.all(payoutJobs);
  if (Object.keys(betUpdates).length) await betsRef(marketId).update(betUpdates);

  await getDatabase().ref('bettingMarket/reserveFund/balance').transaction((bal) => (bal || 0) + result.reserveDelta);

  const now = Date.now();
  await ref.update({
    status: 'settled',
    settlement: {
      winningOutcomeId,
      payoutMultiplier: result.multiplier,
      settledAt: now,
      settledBy: uid,
    },
  });

  // 12번 — 주제 제안 흥행 보상 (rewards.js)
  if (market.category === 'userProposed' && market.proposerUid) {
    const { payoutProposalReward } = require('./rewards');
    await payoutProposalReward(market.proposerUid, uniqueParticipants.size);
  }

  await logAudit(uid, request.auth.token.name, '판정 확정', market.title + ' → "' + market.outcomes[winningOutcomeId].label + '" 적중');
  return { status: 'settled', payoutMultiplier: result.multiplier };
});

module.exports = {
  submitMarketProposal,
  reviewProposal,
  closeMarketEarly,
  voidMarket,
  judgeMarket,
};
