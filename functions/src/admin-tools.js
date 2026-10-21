const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { GoogleAuth } = require('google-auth-library');
const { requireAdmin, requireAdminOrVerifiedStreamer } = require('./lib/auth');
const { adjustBalance, ensureWallet, kstDateKey } = require('./lib/wallet');
const { logAudit } = require('./lib/audit');
const { RAKE_RATE } = require('./constants');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ADMIN_DASHBOARD_CACHE_MS = 5 * 60 * 1000;
const USAGE_DASHBOARD_CACHE_MS = 60 * 60 * 1000;
const RTDB_DOWNLOAD_FREE_BYTES = 10 * 1000 * 1000 * 1000;
const RTDB_STORAGE_FREE_BYTES = 1 * 1000 * 1000 * 1000;
const RTDB_DOWNLOAD_USD_PER_GB = 1;
const RTDB_STORAGE_USD_PER_GB_MONTH = 5;

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
  const cacheRef = db.ref('bettingMarket/adminStats/dashboardCache');
  const cacheSnap = await cacheRef.get();
  const cache = cacheSnap.val();
  if (cache && cache.data && Date.now() - (cache.computedAt || 0) < ADMIN_DASHBOARD_CACHE_MS) {
    return cache.data;
  }
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

  const data = {
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
  await cacheRef.set({ computedAt: Date.now(), data });
  return data;
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
  const startMs = Date.parse(bucketKeys[0] + (granularity === 'month' ? '-01' : '') + 'T00:00:00+09:00');
  const endMs = Date.now();
  const walletsSnap = await db.ref('bettingMarket/wallets')
    .orderByChild('accountCreatedAt').startAt(startMs).endAt(endMs).get();
  Object.values(walletsSnap.val() || {}).forEach((w) => {
    if (!w.accountCreatedAt) return;
    const key = bucketKeyForTimestamp(w.accountCreatedAt, granularity);
    if (buckets[key]) buckets[key].newWallets += 1;
  });

  const marketsSnap = await db.ref('bettingMarket/markets').get();
  const marketIds = [];
  marketsSnap.forEach((child) => marketIds.push(child.key));
  // 모든 마켓은 유지하되, 각 마켓의 placedAt 인덱스로 차트 기간 배팅만 읽는다.
  // 장기간 열린 마켓도 놓치지 않으면서 기존의 전체 bets 트리 다운로드를 피한다.
  for (let offset = 0; offset < marketIds.length; offset += 25) {
    const batch = marketIds.slice(offset, offset + 25);
    const betSnaps = await Promise.all(batch.map((marketId) => db.ref('bettingMarket/bets/' + marketId)
      .orderByChild('placedAt').startAt(startMs).endAt(endMs).get()));
    betSnaps.forEach((betsSnap) => {
      betsSnap.forEach((child) => {
        const bet = child.val() || {};
        if (!bet.placedAt) return;
        const key = bucketKeyForTimestamp(bet.placedAt, granularity);
        if (buckets[key]) {
          buckets[key].betAmount += bet.amount || 0;
          buckets[key].betCount += 1;
        }
      });
    });
  }

  return { granularity, series: bucketKeys.map((k) => buckets[k]) };
});

// 관리 탭 이상 거래 모니터링 — 최근 1시간 신규 지갑, 잔액 상위 계정, 최근 24시간 환전 총액 (관리자·인증 스트리머)
const getAnomalyMonitor = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  const now = Date.now();
  await ensureExchangeLogIndex(db);

  const [recentWalletsSnap, topWalletsSnap, exchangesSnap] = await Promise.all([
    db.ref('bettingMarket/wallets').orderByChild('accountCreatedAt').startAt(now - HOUR_MS).endAt(now).get(),
    db.ref('bettingMarket/wallets').orderByChild('balance').limitToLast(10).get(),
    db.ref('bettingMarket/exchangeLog').orderByChild('requestedAt').startAt(now - DAY_MS).endAt(now).get(),
  ]);

  const recentWalletRows = [];
  recentWalletsSnap.forEach((child) => recentWalletRows.push({ uid: child.key, ...child.val() }));
  recentWalletRows.sort((a, b) => (b.accountCreatedAt || 0) - (a.accountCreatedAt || 0));
  const topWalletRows = [];
  topWalletsSnap.forEach((child) => topWalletRows.push({ uid: child.key, ...child.val() }));
  topWalletRows.sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const exchangeEntries = [];
  exchangesSnap.forEach((child) => exchangeEntries.push(child.val() || {}));
  let exchangeAmount24h = 0;
  exchangeEntries.forEach((e) => { exchangeAmount24h += e.amount || 0; });
  const profileUids = [...new Set(recentWalletRows.slice(0, 30).concat(topWalletRows).map((w) => w.uid))];
  const profileSnaps = await Promise.all(profileUids.map((uid) => db.ref('bettingMarket/profiles/' + uid).get()));
  const profiles = {};
  profileUids.forEach((uid, i) => { profiles[uid] = profileSnaps[i].val() || {}; });
  const recentWallets = recentWalletRows.slice(0, 30).map((w) => ({ ...w, nickname: nicknameFor(profiles, w.uid) }));
  const topBalances = topWalletRows.map((w) => ({ uid: w.uid, nickname: nicknameFor(profiles, w.uid), balance: w.balance || 0 }));

  return {
    recentWalletsCount: recentWallets.length,
    recentWallets: recentWallets.slice(0, 30),
    topBalances,
    exchangeAmount24h,
    exchangeCount24h: exchangeEntries.length,
  };
});

// 관리 탭 환전 내역 조회 — 최근 100건 (관리자·인증 스트리머)
const getExchangeLog = onCall(async (request) => {
  await requireAdminOrVerifiedStreamer(request);
  const db = getDatabase();
  await ensureExchangeLogIndex(db);
  const logSnap = await db.ref('bettingMarket/exchangeLog').orderByChild('requestedAt').limitToLast(100).get();
  const entries = [];
  logSnap.forEach((child) => entries.push({ id: child.key, ...(child.val() || {}) }));
  entries.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  const uids = [...new Set(entries.map((e) => e.uid).filter(Boolean))];
  const profileSnaps = await Promise.all(uids.map((uid) => db.ref('bettingMarket/profiles/' + uid).get()));
  const profiles = {};
  uids.forEach((uid, i) => { profiles[uid] = profileSnaps[i].val() || {}; });
  return { entries: entries.map((e) => ({ ...e, nickname: nicknameFor(profiles, e.uid) })).slice(0, 100) };
});

function utcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

async function ensureExchangeLogIndex(db) {
  const markerRef = db.ref('bettingMarket/exchangeLog/_meta/backfilledAt');
  if ((await markerRef.get()).exists()) return;
  const legacySnap = await db.ref('bettingMarket/exchanges').get();
  const legacyEntries = [];
  legacySnap.forEach((uidSnap) => {
    uidSnap.forEach((entrySnap) => legacyEntries.push({ id: entrySnap.key, uid: uidSnap.key, ...entrySnap.val() }));
  });
  legacyEntries.sort((a, b) => (b.requestedAt || 0) - (a.requestedAt || 0));
  const updates = {};
  // 목록은 최근 100건만 노출되므로 마이그레이션도 여유분 1,000건으로 제한한다.
  legacyEntries.slice(0, 1000).forEach((entry) => {
    updates['bettingMarket/exchangeLog/' + entry.id] = entry;
  });
  updates['bettingMarket/exchangeLog/_meta/backfilledAt'] = Date.now();
  await db.ref().update(updates);
}

async function fetchMonitoringSeries(accessToken, metricType, startTime, endTime, aligner, additionalFilter) {
  const filter = 'metric.type="' + metricType + '"' + (additionalFilter ? ' AND (' + additionalFilter + ')' : '');
  const params = new URLSearchParams({
    filter,
    'interval.startTime': startTime,
    'interval.endTime': endTime,
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': aligner,
    view: 'FULL',
  });
  const response = await fetch('https://monitoring.googleapis.com/v3/projects/soop-stock-market/timeSeries?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error('Cloud Monitoring 조회 실패 (' + response.status + '): ' + detail.slice(0, 300));
  }
  const payload = await response.json();
  return (payload.timeSeries || []).flatMap((series) => (series.points || []).map((point) => {
    const value = point.value || {};
    const distribution = value.distributionValue || {};
    return {
      functionName: series.resource && series.resource.labels && series.resource.labels.function_name,
      serviceName: series.resource && series.resource.labels && series.resource.labels.service_name,
      endTime: point.interval && point.interval.endTime,
      value: Number(value.int64Value || value.doubleValue || 0),
      distributionCount: Number(distribution.count || 0),
      distributionMean: Number(distribution.mean || 0),
    };
  }));
}

// 공유 RTDB 전체의 최근 사용량과 무료 구간 적용 후 예상치를 관리자 전용으로 보여준다.
// Firebase RTDB 메트릭은 자매 서비스별 경로 귀속을 제공하지 않으므로 배팅시장 단독 비용으로 표시하지 않는다.
const getBettingMarketUsage = onCall(async (request) => {
  await requireAdmin(request);
  const db = getDatabase();
  const cacheRef = db.ref('bettingMarket/adminUsage/summaryCache');
  const cachedSnap = await cacheRef.get();
  const cached = cachedSnap.val();
  if (cached && cached.data && Date.now() - (cached.computedAt || 0) < USAGE_DASHBOARD_CACHE_MS) {
    return cached.data;
  }
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));
  const endTime = end.toISOString();
  const startTime = start.toISOString();
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/monitoring.read'] });
  const client = await auth.getClient();
  const tokenResult = await client.getAccessToken();
  const accessToken = typeof tokenResult === 'string' ? tokenResult : tokenResult.token;
  if (!accessToken) throw new Error('Cloud Monitoring 인증 토큰을 가져오지 못했습니다.');

  const [downloadPoints, storagePoints] = await Promise.all([
    fetchMonitoringSeries(accessToken, 'firebasedatabase.googleapis.com/network/sent_bytes_count', startTime, endTime, 'ALIGN_SUM'),
    fetchMonitoringSeries(accessToken, 'firebasedatabase.googleapis.com/storage/total_bytes', startTime, endTime, 'ALIGN_MAX'),
  ]);
  const functionNames = Object.keys(require('../index')).sort();
  const functionCountPoints = [];
  const functionTimePoints = [];
  const functionBillablePoints = [];
  for (let offset = 0; offset < functionNames.length; offset += 18) {
    const names = functionNames.slice(offset, offset + 18);
    const functionFilter = names.map((name) => 'resource.labels.function_name="' + name + '"').join(' OR ');
    const serviceFilter = names.map((name) => 'resource.labels.service_name="' + name.toLowerCase() + '"').join(' OR ');
    const [counts, runtimes, billable] = await Promise.all([
      fetchMonitoringSeries(accessToken, 'cloudfunctions.googleapis.com/function/execution_count', startTime, endTime, 'ALIGN_SUM', functionFilter),
      fetchMonitoringSeries(accessToken, 'cloudfunctions.googleapis.com/function/execution_times', startTime, endTime, 'ALIGN_SUM', functionFilter),
      fetchMonitoringSeries(accessToken, 'run.googleapis.com/container/billable_instance_time', startTime, endTime, 'ALIGN_SUM', serviceFilter),
    ]);
    functionCountPoints.push(...counts);
    functionTimePoints.push(...runtimes);
    functionBillablePoints.push(...billable);
  }
  const daily = {};
  downloadPoints.forEach((point) => {
    if (!point.endTime) return;
    const day = utcDateKey(new Date(Date.parse(point.endTime) - 1));
    daily[day] = { ...(daily[day] || {}), downloadedBytes: point.value };
  });
  storagePoints.forEach((point) => {
    if (!point.endTime) return;
    const day = utcDateKey(new Date(Date.parse(point.endTime) - 1));
    daily[day] = { ...(daily[day] || {}), storedBytes: point.value };
  });

  const dailyRef = db.ref('bettingMarket/adminUsage/rtdbDaily');
  const existingSnap = await dailyRef.get();
  const existing = existingSnap.val() || {};
  const updates = {};
  Object.keys(daily).forEach((day) => {
    const record = daily[day];
    const old = existing[day] || {};
    if (record.downloadedBytes != null && old.downloadedBytes !== record.downloadedBytes) updates[day + '/downloadedBytes'] = record.downloadedBytes;
    if (record.storedBytes != null && old.storedBytes !== record.storedBytes) updates[day + '/storedBytes'] = record.storedBytes;
    if (Object.keys(updates).some((key) => key.startsWith(day + '/'))) updates[day + '/sampledAt'] = Date.now();
  });
  const cutoffDay = utcDateKey(start);
  Object.keys(existing).forEach((day) => {
    if (day < cutoffDay) updates[day] = null;
  });
  if (Object.keys(updates).length) await dailyRef.update(updates);

  const downloadBytes30d = downloadPoints.reduce((sum, point) => sum + point.value, 0);
  const latestStorage = storagePoints.sort((a, b) => Date.parse(b.endTime || 0) - Date.parse(a.endTime || 0))[0];
  const storedBytes = latestStorage ? latestStorage.value : 0;
  const functionExecutions30d = functionCountPoints.reduce((sum, point) => sum + point.value, 0);
  const functionRuntimeSeconds30d = functionTimePoints.reduce((sum, point) => sum + point.distributionCount * point.distributionMean / 1e9, 0);
  const functionBillableInstanceSeconds30d = functionBillablePoints.reduce((sum, point) => sum + point.value, 0);
  const estimatedFunctionUsdNoFreeQuota = functionBillableInstanceSeconds30d * (0.000024 + 0.25 * 0.0000025) + functionExecutions30d * 0.40 / 1000000;
  const downloadedGb30d = downloadBytes30d / 1e9;
  const storedGb = storedBytes / 1e9;
  const downloadOverageGb = Math.max(0, downloadedGb30d - RTDB_DOWNLOAD_FREE_BYTES / 1e9);
  const storageOverageGb = Math.max(0, storedGb - RTDB_STORAGE_FREE_BYTES / 1e9);
  const data = {
    scope: 'shared-project',
    sampledAt: endTime,
    rangeStart: startTime,
    rangeEnd: endTime,
    downloadBytes30d: Math.round(downloadBytes30d),
    storedBytes,
    streamBetFunctionExecutions30d: Math.round(functionExecutions30d),
    streamBetFunctionRuntimeSeconds30d: Math.round(functionRuntimeSeconds30d),
    streamBetFunctionBillableInstanceSeconds30d: Math.round(functionBillableInstanceSeconds30d),
    estimatedFunctionUsdNoFreeQuota,
    estimatedSchedulerUsdMonthlyRange: [0, 0.10],
    downloadedGb30d,
    storedGb,
    estimatedDownloadUsd: downloadOverageGb * RTDB_DOWNLOAD_USD_PER_GB,
    estimatedStorageUsdMonthly: storageOverageGb * RTDB_STORAGE_USD_PER_GB_MONTH,
    estimatedRtdbUsdMonthly: downloadOverageGb * RTDB_DOWNLOAD_USD_PER_GB + storageOverageGb * RTDB_STORAGE_USD_PER_GB_MONTH,
    daily: Object.keys(daily).sort().map((day) => ({ day, ...daily[day] })),
    pricing: {
      freeDownloadGbPerMonth: 10,
      freeStorageGb: 1,
      downloadUsdPerGb: 1,
      storageUsdPerGbMonth: 5,
      cloudRunCpuUsdPerVcpuSecond: 0.000024,
      cloudRunMemoryUsdPerGiBSecond: 0.0000025,
      cloudRunRequestUsdPerMillion: 0.40,
      schedulerUsdPerJobMonth: 0.10,
    },
  };
  await cacheRef.set({ computedAt: Date.now(), data });
  return data;
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
    db.ref('bannedAccounts/' + uid).get(),
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

  // 20번 2단계 — 공유 원장의 이 저장소(bettingMarket) 관점 정지 상태만 골라 반환한다.
  const banData = banSnap.val();
  let banned = null;
  if (banData) {
    if (banData.all) banned = { reason: banData.allReason || '', bannedAt: banData.allBannedAt || 0, all: true };
    else if (banData.games && banData.games.bettingMarket) banned = { ...banData.games.bettingMarket, all: false };
  }

  return {
    uid,
    profile: profileSnap.val() || null,
    wallet: walletSnap.val() || null,
    bets,
    exchanges,
    banned,
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

// 관리 탭 계정 정지 (관리자 전용). 20번 2단계 — soop-stock-market과 공유하는
// bannedAccounts/{uid}/games/bettingMarket에 쓴다(게임별 정지가 기본).
const banAccount = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { uid, reason } = request.data || {};
  if (!uid) throw new HttpsError('invalid-argument', '대상 uid를 입력해 주세요.');
  if (!reason || !reason.trim()) throw new HttpsError('invalid-argument', '정지 사유를 입력해 주세요.');

  await getDatabase().ref('bannedAccounts/' + uid + '/games/bettingMarket').set({
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

  await getDatabase().ref('bannedAccounts/' + uid + '/games/bettingMarket').remove();
  await logAudit(adminUid, adminName, '계정 정지 해제', uid);
  return { status: 'unbanned' };
});

module.exports = {
  getAdminDashboardStats,
  getStatsTimeseries,
  getAnomalyMonitor,
  getExchangeLog,
  getBettingMarketUsage,
  adminLookupUser,
  adminAdjustBalance,
  banAccount,
  unbanAccount,
};
