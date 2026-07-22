const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAdmin, requireAdminOrVerifiedStreamer } = require('./lib/auth');
const { adjustBalance, ensureWallet, kstDateKey } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function loadProfiles() {
  const snap = await getDatabase().ref('bettingMarket/profiles').get();
  return snap.val() || {};
}

function nicknameFor(profiles, uid) {
  return (profiles[uid] && profiles[uid].nickname) || '';
}

// 관리 탭 대시보드 — 지갑 총량·오늘 신규 지갑·활성 마켓·오늘 배팅액 (관리자·인증 스트리머)
const getAdminDashboardStats = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  const today = kstDateKey();

  const [walletsSnap, marketsSnap, betsSnap] = await Promise.all([
    db.ref('bettingMarket/wallets').get(),
    db.ref('bettingMarket/markets').get(),
    db.ref('bettingMarket/bets').get(),
  ]);

  const wallets = walletsSnap.val() || {};
  let totalCirculation = 0;
  let newWalletsToday = 0;
  Object.values(wallets).forEach((w) => {
    totalCirculation += w.balance || 0;
    if (kstDateKey(new Date(w.accountCreatedAt || 0)) === today) newWalletsToday += 1;
  });

  const markets = marketsSnap.val() || {};
  const activeMarkets = Object.values(markets).filter((m) => m.status === 'open' || m.status === 'closed').length;

  const betsByMarket = betsSnap.val() || {};
  let totalBetAmountToday = 0;
  let totalBetCountToday = 0;
  Object.values(betsByMarket).forEach((bets) => {
    Object.values(bets).forEach((bet) => {
      if (kstDateKey(new Date(bet.placedAt || 0)) === today) {
        totalBetAmountToday += bet.amount || 0;
        totalBetCountToday += 1;
      }
    });
  });

  return {
    totalWallets: Object.keys(wallets).length,
    totalCirculation,
    newWalletsToday,
    activeMarkets,
    totalBetAmountToday,
    totalBetCountToday,
  };
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
  getAnomalyMonitor,
  getExchangeLog,
  adminLookupUser,
  adminAdjustBalance,
  banAccount,
  unbanAccount,
};
