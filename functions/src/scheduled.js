const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getDatabase } = require('firebase-admin/database');

// 06번 — 배팅 마감 시각(서버 시각 기준)이 지난 open 마켓을 자동으로 closed 처리
const closeBettingScheduled = onSchedule('every 1 minutes', async () => {
  const db = getDatabase();
  const snap = await db.ref('bettingMarket/markets').orderByChild('status').equalTo('open').get();
  if (!snap.exists()) return;
  const now = Date.now();
  const updates = {};
  snap.forEach((child) => {
    const market = child.val();
    if (market.timing && market.timing.bettingClosesAt <= now) {
      updates[child.key + '/status'] = 'closed';
    }
  });
  if (Object.keys(updates).length) {
    await db.ref('bettingMarket/markets').update(updates);
  }
});

module.exports = { closeBettingScheduled };
