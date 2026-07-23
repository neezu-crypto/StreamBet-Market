(function () {
  var navMarket = document.getElementById('nav-market');
  var navAdmin = document.getElementById('nav-admin');
  var navRanking = document.getElementById('nav-ranking');
  var navSettlement = document.getElementById('nav-settlement');
  var marketView = document.getElementById('market-view');
  var adminView = document.getElementById('admin-view');
  var rankingView = document.getElementById('ranking-view');
  var settlementView = document.getElementById('settlement-view');
  if (!navMarket || !navAdmin || !navRanking || !navSettlement || !marketView || !adminView || !rankingView || !settlementView) return;

  var tabs = [
    { nav: navMarket, view: marketView },
    { nav: navAdmin, view: adminView },
    { nav: navRanking, view: rankingView },
    { nav: navSettlement, view: settlementView }
  ];

  function showTab(active) {
    tabs.forEach(function (t) {
      var isActive = t.nav === active.nav;
      t.view.style.display = isActive ? '' : 'none';
      t.nav.classList.toggle('active', isActive);
    });
  }

  function sbmCanUseAdminTab() {
    return !!(window.sbmIsAdmin || window.sbmIsVerifiedStreamer);
  }

  // 관리 탭은 관리자 · 인증 스트리머에게만 보여준다. 실제 데이터 접근·조작 권한은
  // RTDB 규칙과 Cloud Functions가 이미 막고 있지만, 일반 유저에게는 탭 버튼 자체와
  // 진입을 UX 차원에서도 차단한다.
  function sbmUpdateAdminTabVisibility() {
    var allowed = sbmCanUseAdminTab();
    navAdmin.style.display = allowed ? '' : 'none';
    if (!allowed && adminView.style.display !== 'none') {
      showTab(tabs[0]); // 지금 관리 탭을 보고 있는데 권한을 잃으면 마켓 탭으로 되돌린다
    }
  }
  document.addEventListener('sbm-auth-changed', sbmUpdateAdminTabVisibility);
  sbmUpdateAdminTabVisibility();

  navMarket.addEventListener('click', function (e) { e.preventDefault(); showTab(tabs[0]); });
  navAdmin.addEventListener('click', function (e) {
    e.preventDefault();
    if (!sbmCanUseAdminTab()) return; // 버튼이 숨겨져 있어도 직접 조작될 가능성 대비
    showTab(tabs[1]);
    sbmRenderAdminChat();
    sbmRenderAuditLog();
    sbmRenderVerifiedStreamers();
    sbmRenderReportQueue();
    sbmRenderNicknameReportQueue();
    sbmRenderBlockedNicknames();
    sbmRenderAdminDashboard();
    sbmRenderStatsChart();
    sbmRenderAnomalyMonitor();
    sbmRenderExchangeLog();
    // 아래는 규칙(rules)상으로도 관리자 전용으로 막혀있는 데이터 — 인증 스트리머 세션에서는
    // 아예 구독을 시도하지 않는다(어차피 막히지만 콘솔에 권한 오류가 안 남게).
    if (window.sbmIsAdmin) {
      sbmRenderVerifyRequests();
      sbmRenderChargeRequests();
      sbmRenderStreamerRequests();
      sbmSubscribeBannedAccounts();
    }
  });
  navRanking.addEventListener('click', function (e) {
    e.preventDefault();
    showTab(tabs[2]);
    sbmApplyNicknameBlocks();
  });
  navSettlement.addEventListener('click', function (e) { e.preventDefault(); showTab(tabs[3]); });

  document.querySelectorAll('.ranking-tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ranking-tab-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      ['asset', 'winrate', 'profit'].forEach(function (key) {
        var el = document.getElementById('ranking-list-' + key);
        if (el) el.style.display = key === btn.getAttribute('data-ranking') ? '' : 'none';
      });
    });
  });

  sbmRenderAuditLog();
})();

(function () {
  var emptyStateBtn = document.getElementById('empty-state-propose-btn');
  var fab = document.querySelector('.fab');
  if (emptyStateBtn && fab) {
    emptyStateBtn.addEventListener('click', function () { fab.click(); });
  }
})();
