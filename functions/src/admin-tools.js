const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { requireAdmin, requireAdminOrVerifiedStreamer } = require('./lib/auth');
const { adjustBalance, ensureWallet, kstDateKey } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const { RAKE_RATE } = require('./constants');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function loadProfiles() {
  const snap = await getDatabase().ref('bettingMarket/profiles').get();
  return snap.val() || {};
}

function nicknameFor(profiles, uid) {
  return (profiles[uid] && profiles[uid].nickname) || '';
}

// bettingMarket/wallets에 지갑이 있는(=실제로 게임에 참여한) uid들을 실계정/익명으로 분류한다.
// Firebase Auth의 getUsers는 한 번에 최대 100개 식별자만 받으므로 청크로 나눠 조회한다.
async function countAccountTypes(uids) {
  let anonymousCount = 0;
  let realCount = 0;
  const auth = getAuth();
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100).map((uid) => ({ uid }));
    if (!chunk.length) continue;
    const result = await auth.getUsers(chunk);
    result.users.forEach((u) => {
      if (u.providerData && u.providerData.length > 0) realCount += 1;
      else anonymousCount += 1;
    });
    anonymousCount += result.notFound.length; // Auth에서 이미 지워졌으면 익명으로 취급
  }
  return { anonymousCount, realCount };
}

// 관리 탭 대시보드 — 오늘 지표 + 누적(전체 기간) 지표 + 재무 건전성 지표 (관리자·인증 스트리머)
const getAdminDashboardStats = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  const today = kstDateKey();

  const [walletsSnap, marketsSnap, betsSnap, verificationsSnap, reserveSnap, jackpotSnap, jackpotWinsSnap, exchangesSnap] = await Promise.all([
    db.ref('bettingMarket/wallets').get(),
    db.ref('bettingMarket/markets').get(),
    db.ref('bettingMarket/bets').get(),
    db.ref('streamerVerifications').get(),
    db.ref('bettingMarket/reserveFund/balance').get(),
    db.ref('bettingMarket/jackpot/balance').get(),
    db.ref('bettingMarket/jackpotWins').get(),
    db.ref('bettingMarket/exchanges').get(),
  ]);

  const wallets = walletsSnap.val() || {};
  let totalCirculation = 0;
  let newWalletsToday = 0;
  let attendanceParticipantCount = 0;
  Object.values(wallets).forEach((w) => {
    totalCirculation += w.balance || 0;
    if (kstDateKey(new Date(w.accountCreatedAt || 0)) === today) newWalletsToday += 1;
    if (w.attendanceStreak > 0 || w.lastAttendanceDate) attendanceParticipantCount += 1;
  });
  const totalWallets = Object.keys(wallets).length;

  const { anonymousCount, realCount } = await countAccountTypes(Object.keys(wallets));
  const verifiedStreamerCount = Object.keys(verificationsSnap.val() || {}).length;

  const markets = marketsSnap.val() || {};
  const marketList = Object.values(markets);
  const activeMarkets = marketList.filter((m) => m.status === 'open' || m.status === 'closed').length;
  const settledCount = marketList.filter((m) => m.status === 'settled').length;
  const voidCount = marketList.filter((m) => m.status === 'void').length;
  const settledOrVoidCount = settledCount + voidCount;
  const voidRatePercent = settledOrVoidCount ? Math.round((voidCount / settledOrVoidCount) * 1000) / 10 : 0;

  // 누적 하우스 수익(수수료) — 정산 완료된 마켓의 totalPool × rakeRate 합산 (실제 rake는 정산 시점에
  // 이미 잭팟·준비금으로 분배됐고 별도 누적 카운터가 없어, 정산된 마켓 기록에서 역산한다)
  let totalRakeCollected = 0;
  marketList.forEach((m) => {
    if (m.status === 'settled') {
      totalRakeCollected += (m.totalPool || 0) * (m.rakeRate != null ? m.rakeRate : RAKE_RATE);
    }
  });

  const betsByMarket = betsSnap.val() || {};
  let totalBetAmountToday = 0;
  let totalBetCountToday = 0;
  let totalBetAmountAllTime = 0;
  let totalBetCountAllTime = 0;
  let totalPayoutAllTime = 0;
  Object.values(betsByMarket).forEach((bets) => {
    Object.values(bets).forEach((bet) => {
      totalBetAmountAllTime += bet.amount || 0;
      totalBetCountAllTime += 1;
      if (bet.status === 'paid') totalPayoutAllTime += bet.payout || 0;
      if (kstDateKey(new Date(bet.placedAt || 0)) === today) {
        totalBetAmountToday += bet.amount || 0;
        totalBetCountToday += 1;
      }
    });
  });

  let totalExchangeAmountAllTime = 0;
  Object.values(exchangesSnap.val() || {}).forEach((entries) => {
    Object.values(entries).forEach((e) => { totalExchangeAmountAllTime += e.amount || 0; });
  });

  const jackpotWins = Object.values(jackpotWinsSnap.val() || {});
  const jackpotWinCount = jackpotWins.length;
  const jackpotTotalPaid = jackpotWins.reduce((sum, w) => sum + (w.amount || 0), 0);

  return {
    // 오늘
    newWalletsToday,
    activeMarkets,
    totalBetAmountToday,
    totalBetCountToday,
    // 회원 구성
    totalWallets,
    anonymousCount,
    realCount,
    verifiedStreamerCount,
    // 누적(전체 기간)
    totalBetAmountAllTime,
    totalBetCountAllTime,
    avgBetAmount: totalBetCountAllTime ? Math.round(totalBetAmountAllTime / totalBetCountAllTime) : 0,
    avgWalletBalance: totalWallets ? Math.round(totalCirculation / totalWallets) : 0,
    settledCount,
    voidCount,
    voidRatePercent,
    totalPayoutAllTime,
    totalExchangeAmountAllTime,
    totalRakeCollected,
    jackpotWinCount,
    jackpotTotalPaid,
    attendanceParticipantCount,
    // 재무 건전성
    totalCirculation,
    reserveFundBalance: reserveSnap.val() || 0,
    jackpotBalance: jackpotSnap.val() || 0,
  };
});

// 일간/주간/월간 통계 그래프용 시계열 집계 (관리자·인증 스트리머)
function bucketKeyForTimestamp(ts, granularity) {
  const dateKey = kstDateKey(new Date(ts)); // 'YYYY-MM-DD' (KST)
  if (granularity === 'day') return dateKey;
  const [y, m, d] = dateKey.split('-').map(Number);
  if (granularity === 'month') return y + '-' + String(m).padStart(2, '0');
  const dateUTC = new Date(Date.UTC(y, m - 1, d));
  const dow = dateUTC.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(dateUTC.getTime() + diffToMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

function generateBucketKeys(granularity, count) {
  const keys = [];
  const now = new Date();
  if (granularity === 'day') {
    for (let i = count - 1; i >= 0; i--) keys.push(kstDateKey(new Date(now.getTime() - i * DAY_MS)));
  } else if (granularity === 'week') {
    const todayKey = kstDateKey(now);
    const [y, m, d] = todayKey.split('-').map(Number);
    const todayUTC = new Date(Date.UTC(y, m - 1, d));
    const dow = todayUTC.getUTCDay();
    const diffToMonday = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(todayUTC.getTime() + diffToMonday * DAY_MS);
    for (let i = count - 1; i >= 0; i--) keys.push(new Date(monday.getTime() - i * 7 * DAY_MS).toISOString().slice(0, 10));
  } else {
    const todayKey = kstDateKey(now);
    const [y, m] = todayKey.split('-').map(Number);
    for (let i = count - 1; i >= 0; i--) {
      let yy = y, mm = m - i;
      while (mm <= 0) { mm += 12; yy -= 1; }
      keys.push(yy + '-' + String(mm).padStart(2, '0'));
    }
  }
  return keys;
}

const getStatsTimeseries = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const granularity = ['day', 'week', 'month'].includes(request.data && request.data.granularity) ? request.data.granularity : 'day';
  const count = granularity === 'month' ? 6 : granularity === 'week' ? 8 : 14;
  const bucketKeys = generateBucketKeys(granularity, count);
  const buckets = {};
  bucketKeys.forEach((k) => { buckets[k] = { label: k, betAmount: 0, betCount: 0, newWallets: 0 }; });

  const db = getDatabase();
  const [walletsSnap, betsSnap] = await Promise.all([
    db.ref('bettingMarket/wallets').get(),
    db.ref('bettingMarket/bets').get(),
  ]);

  Object.values(walletsSnap.val() || {}).forEach((w) => {
    if (!w.accountCreatedAt) return;
    const key = bucketKeyForTimestamp(w.accountCreatedAt, granularity);
    if (buckets[key]) buckets[key].newWallets += 1;
  });

  Object.values(betsSnap.val() || {}).forEach((bets) => {
    Object.values(bets).forEach((bet) => {
      if (!bet.placedAt) return;
      const key = bucketKeyForTimestamp(bet.placedAt, granularity);
      if (buckets[key]) {
        buckets[key].betAmount += bet.amount || 0;
        buckets[key].betCount += 1;
      }
    });
  });

  return { granularity, series: bucketKeys.map((k) => buckets[k]) };
});

// 관리 탭 이상 거래 모니터링 — 최근 1시간 신규 지갑, 잔액 상위 계정, 최근 24시간 환전 총액 (관리자·인증 스트리머)
const getAnomalyMonitor = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  const now = Date.now();

  const [walletsSnap, exchangesSnap, profiles] = await Promise.all([
    db.ref('bettingMarket/wallets').get(),
    db.ref('bettingMarket/exchanges').get(),
    loadProfiles(),
  ]);

  const wallets = walletsSnap.val() || {};
  const recentWallets = Object.keys(wallets)
    .map((uid) => ({ uid, nickname: nicknameFor(profiles, uid), ...wallets[uid] }))
    .filter((w) => now - (w.accountCreatedAt || 0) < HOUR_MS)
    .sort((a, b) => (b.accountCreatedAt || 0) - (a.accountCreatedAt || 0));

  const topBalances = Object.keys(wallets)
    .map((uid) => ({ uid, nickname: nicknameFor(profiles, uid), balance: wallets[uid].balance || 0 }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);

  const exchangesByUid = exchangesSnap.val() || {};
  let exchangeAmount24h = 0;
  let exchangeCount24h = 0;
  Object.values(exchangesByUid).forEach((entries) => {
    Object.values(entries).forEach((e) => {
      if (now - (e.requestedAt || 0) < DAY_MS) {
        exchangeAmount24h += e.amount || 0;
        exchangeCount24h += 1;
      }
    });
  });

  return {
    recentWalletsCount: recentWallets.length,
    recentWallets: recentWallets.slice(0, 30),
    topBalances,
    exchangeAmount24h,
    exchangeCount24h,
  };
});

// 관리 탭 환전 내역 조회 — 최근 100건 (관리자·인증 스트리머)
const getExchangeLog = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  const [exchangesSnap, profiles] = await Promise.all([
    db.ref('bettingMarket/exchanges').get(),
    loadProfiles(),
  ]);
  const exchangesByUid = exchangesSnap.val() || {};
  const entries = [];
  Object.keys(exchangesByUid).forEach((uid) => {
    Object.values(exchangesByUid[uid]).forEach((e) => {
      entries.push({ uid, nickname: nicknameFor(profiles, uid), ...e });
    });
  });
  entries.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  return { entries: entries.slice(0, 100) };
});

// 관리 탭 유저 검색 — 닉네임 또는 uid로 지갑·최근 배팅·환전 내역 조회 (관리자 전용)
const adminLookupUser = onCall(async (request) => {
  await requireAdmin(request);
  const query = ((request.data && request.data.query) || '').trim();
  if (!query) throw new HttpsError('invalid-argument', '닉네임 또는 uid를 입력해 주세요.');

  const db = getDatabase();
  let uid = query;
  const byNickname = await db.ref('bettingMarket/profiles').orderByChild('nickname').equalTo(query).limitToFirst(1).get();
  if (byNickname.exists()) {
    uid = Object.keys(byNickname.val())[0];
  }

  const [walletSnap, profileSnap, userBetsSnap, exchangesSnap, banSnap] = await Promise.all([
    db.ref('bettingMarket/wallets/' + uid).get(),
    db.ref('bettingMarket/profiles/' + uid).get(),
    db.ref('bettingMarket/userBets/' + uid).get(),
    db.ref('bettingMarket/exchanges/' + uid).get(),
    db.ref('bettingMarket/bannedAccounts/' + uid).get(),
  ]);

  if (!walletSnap.exists() && !profileSnap.exists()) {
    throw new HttpsError('not-found', '일치하는 유저를 찾을 수 없습니다.');
  }

  const userBetsIdx = userBetsSnap.val() || {};
  const betRefs = [];
  Object.keys(userBetsIdx).forEach((marketId) => {
    Object.keys(userBetsIdx[marketId]).forEach((betId) => {
      betRefs.push(db.ref('bettingMarket/bets/' + marketId + '/' + betId).get().then((s) => ({ marketId, betId, ...s.val() })));
    });
  });
  const bets = (await Promise.all(betRefs)).sort((a, b) => (b.placedAt || 0) - (a.placedAt || 0)).slice(0, 20);

  const exchanges = Object.values(exchangesSnap.val() || {}).sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0)).slice(0, 20);

  return {
    uid,
    profile: profileSnap.val() || null,
    wallet: walletSnap.val() || null,
    bets,
    exchanges,
    banned: banSnap.exists() ? banSnap.val() : null,
  };
});

// 관리 탭 수동 잔액 조정 — 지급/차감 사유 필수 (관리자 전용)
const adminAdjustBalance = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { uid, delta, reason } = request.data || {};
  const d = Number(delta);
  if (!uid || !Number.isFinite(d) || d === 0 || Math.abs(d) > 100000000) {
    throw new HttpsError('invalid-argument', '대상과 조정 금액을 올바르게 입력해 주세요.');
  }
  if (!reason || !reason.trim()) {
    throw new HttpsError('invalid-argument', '조정 사유를 입력해 주세요.');
  }

  await ensureWallet(uid);
  const wallet = await adjustBalance(uid, d);
  await logAudit(adminUid, adminName, '수동 잔액 조정', uid + ' · ' + (d > 0 ? '+' : '') + d.toLocaleString('ko-KR') + '원 · ' + reason.trim());

  // 당사자도 왜 잔액이 바뀌었는지 알 수 있게 본인 전용 내역에도 남긴다 (정산 내역 탭에 노출).
  await getDatabase().ref('bettingMarket/walletLedger/' + uid).push({
    delta: d,
    reason: reason.trim(),
    at: Date.now(),
  });

  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('adminAdjustBalance');

  return { balance: wallet.balance };
});

// 관리 탭 계정 정지 (관리자 전용)
const banAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { uid, reason } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (!reason || !reason.trim()) throw new HttpsError('invalid-argument', '정지 사유를 입력해 주세요.');

  await getDatabase().ref('bettingMarket/bannedAccounts/' + uid).set({
    reason: reason.trim(),
    bannedAt: Date.now(),
    bannedBy: adminUid,
    bannedByName: adminName,
  });
  await logAudit(adminUid, adminName, '계정 정지', uid + ' · ' + reason.trim());
  return { status: 'banned' };
});

// 관리 탭 계정 정지 해제 (관리자 전용)
const unbanAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { uid } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');

  await getDatabase().ref('bettingMarket/bannedAccounts/' + uid).remove();
  await logAudit(adminUid, adminName, '계정 정지 해제', uid);
  return { status: 'unbanned' };
});

module.exports = {
  getAdminDashboardStats,
  getStatsTimeseries,
  getAnomalyMonitor,
  getExchangeLog,
  adminLookupUser,
  adminAdjustBalance,
  banAccount,
  unbanAccount,
};
