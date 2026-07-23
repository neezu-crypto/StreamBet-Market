// 관리 탭 검수 알림 배너 — 이미 실시간으로 갱신되는 각 검수 목록(admin-pending-list,
// report-queue-list 등)의 DOM을 MutationObserver로 지켜보고 있다가, 항목이 늘거나
// 줄어들 때마다(=검수 완료 시 즉시) 알림 배너 숫자도 함께 갱신한다. 각 목록의 데이터
// 구독·렌더링 로직은 건드리지 않고 이미 그려진 결과만 관찰하므로 다른 모듈과 결합되지 않는다.
var SBM_ADMIN_ALERT_SECTIONS = [
  { listId: 'admin-pending-list', label: '검수 대기 제안', itemSelector: '.admin-item-btn', adminOnly: false },
  { listId: 'report-queue-list', label: '마켓 신고 접수함', itemSelector: '.report-queue-item', adminOnly: false },
  { listId: 'nick-report-queue-list', label: '닉네임 신고 검수', itemSelector: '.report-queue-item', adminOnly: false },
  { listId: 'verify-requests-list', label: '스트리머 인증 신청', itemSelector: '.verify-req-item', adminOnly: true },
  { listId: 'charge-requests-list', label: '자산 충전 신청', itemSelector: '.verify-req-item', adminOnly: true },
  { listId: 'streamer-requests-list', label: '스트리머 추가 요청', itemSelector: '.verify-req-item', adminOnly: true },
];

function sbmRenderAdminAlerts() {
  var listEl = document.getElementById('admin-alerts-list');
  var totalEl = document.getElementById('admin-alerts-total');
  var emptyEl = document.getElementById('admin-alerts-empty');
  if (!listEl || !totalEl || !emptyEl) return;

  var isAdmin = !!window.sbmIsAdmin;
  var rows = [];
  var total = 0;
  SBM_ADMIN_ALERT_SECTIONS.forEach(function (sec) {
    if (sec.adminOnly && !isAdmin) return;
    var container = document.getElementById(sec.listId);
    var count = container ? container.querySelectorAll(sec.itemSelector).length : 0;
    total += count;
    if (count > 0) rows.push({ sec: sec, count: count });
  });

  totalEl.textContent = total;
  totalEl.classList.toggle('zero', total === 0);

  if (!rows.length) {
    listEl.innerHTML = '';
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';
  listEl.innerHTML = rows.map(function (r) {
    return '<button class="admin-alert-item js-admin-alert-goto" data-target="' + r.sec.listId + '" type="button">' +
      '<span class="admin-alert-label">' + sbmEscapeHtml(r.sec.label) + '</span>' +
      '<span class="admin-alert-count">' + r.count + '</span></button>';
  }).join('');
  listEl.querySelectorAll('.js-admin-alert-goto').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-target'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

var sbmAdminAlertsSetUp = false;
function sbmSetupAdminAlerts() {
  if (sbmAdminAlertsSetUp) { sbmRenderAdminAlerts(); return; }
  sbmAdminAlertsSetUp = true;
  SBM_ADMIN_ALERT_SECTIONS.forEach(function (sec) {
    var container = document.getElementById(sec.listId);
    if (!container) return;
    new MutationObserver(sbmRenderAdminAlerts).observe(container, { childList: true });
  });
  sbmRenderAdminAlerts();
}

// 관리자 ↔ 인증 스트리머 세션 전환 시 관리자 전용 항목 포함 여부가 바뀌므로 다시 계산한다.
document.addEventListener('sbm-auth-changed', sbmRenderAdminAlerts);
