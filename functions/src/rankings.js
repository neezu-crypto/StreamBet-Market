const { getDatabase } = require('firebase-admin/database');

// 13번 — 자산 · 승률 · 누적수익 랭킹. 클라이언트는 다른 유저의 wallets/bets를
// 직접 읽을 수 없으므로(본인 uid만 허용), 서버가 주기적으로 집계해 공개 노드에 기록한다.
async function computeRankings() {
  const db = getDatabase();
  const [walletsSnap, profilesSnap, betsSnap, blockedSnap] = await Promise.all([
    db.ref('bettingMarket/wallets').get(),
    db.ref('bettingMarket/profiles').get(),
    db.ref('bettingMarket/bets').get(),
    db.ref('bettingMarket/blockedNicknames').get(),
  ]);
  const wallets = walletsSnap.val() || {};
  const profiles = profilesSnap.val() || {};
  const betsByMarket = betsSnap.val() || {};
  const blocked = blockedSnap.val() || {};

  const stats = {}; // uid -> { totalBet, totalPayout, settledCount, winCount }
  Object.values(betsByMarket).forEach((marketBets) => {
    Object.values(marketBets).forEach((bet) => {
      if (bet.status !== 'paid' && bet.status !== 'lost') return;
      if (!stats[bet.uid]) stats[bet.uid] = { totalBet: 0, totalPayout: 0, settledCount: 0, winCount: 0 };
      const s = stats[bet.uid];
      s.totalBet += bet.amount;
      s.settledCount += 1;
      if (bet.status === 'paid') {
        s.totalPayout += bet.payout || 0;
        s.winCount += 1;
      }
    });
  });

  function displayName(uid) {
    const p = profiles[uid];
    return (p && p.nickname) || '유저' + uid.slice(0, 6);
  }
  function avatarUrl(uid) {
    const p = profiles[uid];
    return (p && p.avatarUrl) || '';
  }

  // 13번 — 차단된 닉네임은 랭킹 전체에서 제외
  const uids = Object.keys(wallets).filter((uid) => !blocked[uid]);

  const assetRanking = uids
    .map((uid) => ({ uid, nickname: displayName(uid), avatarUrl: avatarUrl(uid), value: wallets[uid].balance || 0 }))
    .sort((a, b) => b.value - a.value);

  const winrateRanking = uids
    .filter((uid) => stats[uid] && stats[uid].settledCount > 0)
    .map((uid) => {
      const s = stats[uid];
      return {
        uid,
        nickname: displayName(uid),
        avatarUrl: avatarUrl(uid),
        value: Math.round((s.winCount / s.settledCount) * 100),
        totalCount: s.settledCount,
        winCount: s.winCount,
      };
    })
    .sort((a, b) => b.value - a.value || b.totalCount - a.totalCount);

  const profitRanking = uids
    .filter((uid) => stats[uid])
    .map((uid) => {
      const s = stats[uid];
      return { uid, nickname: displayName(uid), avatarUrl: avatarUrl(uid), value: s.totalPayout - s.totalBet };
    })
    .sort((a, b) => b.value - a.value);

  function toRanked(list) {
    const out = {};
    list.forEach((entry, i) => {
      out[entry.uid] = Object.assign({ rank: i + 1 }, entry);
    });
    return out;
  }

  await db.ref('bettingMarket/rankings').set({
    asset: toRanked(assetRanking),
    winrate: toRanked(winrateRanking),
    profit: toRanked(profitRanking),
    updatedAt: Date.now(),
  });
}

// 고정 주기 폴링 대신, 랭킹에 영향을 주는 이벤트(정산·환전·출석·프로필 변경·닉네임 차단) 직후에만
// 호출한다. 실패해도 원래 하려던 동작(배팅 정산, 환전 등) 자체는 실패하지 않도록 항상 호출부에서
// catch로 감싼다.
async function recomputeRankingsAfter(action) {
  try {
    await computeRankings();
  } catch (e) {
    console.error('랭킹 재계산 실패 (' + action + ')', e);
  }
}

module.exports = { computeRankings, recomputeRankingsAfter };
