const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getDatabase } = require('firebase-admin/database');

// 06번 — 배팅 마감 시각(서버 시각 기준)이 지난 open 마켓을 자동으로 closed 처리 +
// 판정 유예시간(1분)이 지난 pendingSettlement 마켓 확정 지급. 별도 스케줄러를 새로 만드는
// 대신 이미 돌고 있는 이 매분 스케줄에 얹어서 처리한다(스케줄러 비용 추가 없음).
const closeBettingScheduled = onSchedule('every 1 minutes', async () => {
  const db = getDatabase();
  const now = Date.now();

  const openSnap = await db.ref('bettingMarket/markets').orderByChild('status').equalTo('open').get();
  const updates = {};
  if (openSnap.exists()) {
    openSnap.forEach((child) => {
      const market = child.val();
      if (market.timing && market.timing.bettingClosesAt <= now) {
        updates[child.key + '/status'] = 'closed';
      }
    });
  }
  if (Object.keys(updates).length) {
    await db.ref('bettingMarket/markets').update(updates);
  }

  const pendingSnap = await db.ref('bettingMarket/markets').orderByChild('status').equalTo('pendingSettlement').get();
  if (pendingSnap.exists()) {
    const { finalizeMarketSettlement } = require('./markets');
    const jobs = [];
    pendingSnap.forEach((child) => {
      const market = child.val();
      if (market.pendingSettlement && market.pendingSettlement.finalizeAt <= now) {
        jobs.push(finalizeMarketSettlement(child.key, market));
      }
    });
    await Promise.all(jobs);
  }
});

module.exports = { closeBettingScheduled };
