var PROHIBITED_TOPIC_REASONS = [
  '스트리머 비하',
  '평가 불가능한 주관적인 주제',
  '사회적 · 정치적 뉴스 주제',
  '방송 송출 시 주의가 필요한 주제',
  '사생활 · 명예훼손 소지',
  '금전 · 도박 암시 · 유도',
  '불법행위 조장 · 미화',
  '차별 · 혐오 표현 포함'
];

// 07번 — 처리자 식별값은 실제 로그인 유저 기준으로 계산 (더 이상 하드코딩 아님)
function sbmActorLabel() {
  var user = window.sbmRealUser;
  if (!user) return '로그인 필요';
  var name = user.displayName || user.email || user.uid;
  if (window.sbmIsAdmin) return name + ' (관리자)';
  if (window.sbmIsVerifiedStreamer) return name + ' (인증 스트리머)';
  return name;
}

// 10번 — 감사 로그는 서버(Cloud Functions)가 기록한다. 클라이언트는 bettingMarket/auditLog를 읽기만 한다.
function sbmRenderAuditLog() {
  var list = document.getElementById('audit-log');
  if (!list || !window.sbmFirebase || !window.sbmDb) return;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/auditLog'), function (snap) {
    var val = snap.val() || {};
    var log = Object.keys(val).map(function (k) { return val[k]; })
      .sort(function (a, b) { return b.at - a.at; })
      .slice(0, 20);
    if (!log.length) {
      list.innerHTML = '<li class="audit-empty">아직 처리 내역이 없습니다.</li>';
      return;
    }
    list.innerHTML = log.map(function (entry) {
      return '<li><b>' + entry.action + '</b> — ' + entry.detail +
        '<span class="audit-time">' + entry.actorName + ' · ' + new Date(entry.at).toLocaleString('ko-KR') + '</span></li>';
    }).join('');
  });
}
