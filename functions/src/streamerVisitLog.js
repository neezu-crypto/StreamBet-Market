const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase, ServerValue } = require('firebase-admin/database');
const { requireAuth } = require('./lib/auth');

function todayKeyKST() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return kst.toISOString().split('T')[0];
}

// 인증 스트리머가 배팅시장에 접속하면 관리자 디스코드로 알림이 가게 한다.
// 실제 발송은 admin-center의 RTDB 트리거(soop-stock-market 24번 웹훅
// 인프라)가 담당하고, 이 함수는 verifiedStreamerVisits 큐(soop-stock-market
// 앱과 공유하는 경로)에 항목 하나를 쌓는 역할만 한다. 같은 스트리머가
// 새로고침을 반복해도 매번 울리지 않도록 하루(KST)에 한 번만 기록되게
// dedup 노드로 막는다 - market별로 따로 세서, 같은 사람이 주식시장과
// 배팅시장을 둘 다 들르면 각각 한 번씩은 알림이 간다.
const logBettingMarketVisit = onCall(async (request) => {
  const uid = requireAuth(request);
  const db = getDatabase();

  const verifiedSnap = await db.ref('bettingMarket/verifiedStreamerUids/' + uid).get();
  if (verifiedSnap.val() !== true) return { ok: true, logged: false };

  const dateKey = todayKeyKST();
  const dedupRef = db.ref('verifiedStreamerVisitDedup/betting/' + uid + '/' + dateKey);
  let alreadyLogged = false;
  await dedupRef.transaction((cur) => {
    if (cur) {
      alreadyLogged = true;
      return; // abort, 값 유지
    }
    return true;
  });
  if (alreadyLogged) return { ok: true, logged: false };

  const profileSnap = await db.ref('bettingMarket/profiles/' + uid).get();
  const profile = profileSnap.val() || {};

  await db.ref('verifiedStreamerVisits').push({
    uid,
    nickname: profile.nickname || '',
    soopId: profile.soopId || '',
    market: 'betting',
    visitedAt: ServerValue.TIMESTAMP,
  });
  return { ok: true, logged: true };
});

module.exports = { logBettingMarketVisit };
