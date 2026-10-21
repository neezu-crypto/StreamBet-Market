const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getDatabase } = require('firebase-admin/database');

// 06번 — 배팅 마감 시각(서버 시각 기준)이 지난 open 마켓을 자동으로 closed 처리 +
// 판정 유예시간(1분)이 지난 pendingSettlement 마켓 확정 지급. 활동량이 낮은 기간에는
// 5분 간격으로 확인해 불필요한 함수 실행·RTDB 조회를 줄인다(스케줄러 job 수는 그대로).
const closeBettingScheduled = onSchedule('every 5 minutes', async () => {
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
    // 여기서의 market은 스캔 시점 스냅샷 — 실제 취소/재판정 여부·중복 실행 방지는
    // finalizeMarketSettlement 내부의 트랜잭션이 최신 상태 기준으로 다시 확인한다.
    // 이 필터는 그저 확실히 안 될 대상까지 잡을 필요 없이 걸러내는 용도.
    pendingSnap.forEach((child) => {
      const market = child.val();
      if (market.pendingSettlement && market.pendingSettlement.finalizeAt <= now) {
        jobs.push(finalizeMarketSettlement(child.key));
      }
    });
    await Promise.all(jobs);
  }
});

module.exports = { closeBettingScheduled };
