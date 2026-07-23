(function () {
  var navMarket = document.getElementById('nav-market');
  var navAdmin = document.getElementById('nav-admin');
  var navRanking = document.getElementById('nav-ranking');
  var navSkin = document.getElementById('nav-skin');
  var navSettlement = document.getElementById('nav-settlement');
  var marketView = document.getElementById('market-view');
  var adminView = document.getElementById('admin-view');
  var rankingView = document.getElementById('ranking-view');
  var skinView = document.getElementById('skin-view');
  var settlementView = document.getElementById('settlement-view');
  if (!navMarket || !navAdmin || !navRanking || !navSkin || !navSettlement || !marketView || !adminView || !rankingView || !skinView || !settlementView) return;

  var tabs = [
    { nav: navMarket, view: marketView },
    { nav: navAdmin, view: adminView },
    { nav: navRanking, view: rankingView },
    { nav: navSettlement, view: settlementView },
    { nav: navSkin, view: skinView }
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
    sbmSetupAdminAlerts();
    sbmRenderAdminChat();
    sbmRenderAuditLog();
    sbmSubscribeVerifiedStreamers(); // 관리 탭 진입 시에만 인증 목록을 실시간으로 전환
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
  navSkin.addEventListener('click', function (e) { e.preventDefault(); showTab(tabs[4]); });

  // 스킨 탭 — 카테고리 칩으로 카드 목록만 필터링(서버 연동 전 레이아웃 단계, 목업 데이터)
  var skinCategoryFilter = document.getElementById('skin-category-filter');
  var skinGrid = document.getElementById('skin-grid');
  var skinEmpty = document.getElementById('skin-empty');
  if (skinCategoryFilter && skinGrid) {
    skinCategoryFilter.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        skinCategoryFilter.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var category = chip.getAttribute('data-category');
        var visibleCount = 0;
        skinGrid.querySelectorAll('.skin-card').forEach(function (card) {
          var match = category === 'all' || card.getAttribute('data-category') === category;
          card.style.display = match ? '' : 'none';
          if (match) visibleCount += 1;
        });
        if (skinEmpty) skinEmpty.style.display = visibleCount ? 'none' : '';
      });
    });
  }

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

  // 숫자키 1~4 = 마켓/랭킹/스킨/정산 내역 탭, 5 = 관리 탭(관리자·인증 스트리머만). 입력창에
  // 타이핑 중이거나 모달이 열려있을 때는 숫자 입력을 그대로 받아야 하므로 건드리지 않는다.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
    if (document.querySelector('[class*="backdrop"].open')) return;

    if (e.key === '1') { e.preventDefault(); navMarket.click(); }
    else if (e.key === '2') { e.preventDefault(); navRanking.click(); }
    else if (e.key === '3') { e.preventDefault(); navSkin.click(); }
    else if (e.key === '4') { e.preventDefault(); navSettlement.click(); }
    else if (e.key === '5' && sbmCanUseAdminTab()) { e.preventDefault(); navAdmin.click(); }
  });
})();

(function () {
  var emptyStateBtn = document.getElementById('empty-state-propose-btn');
  var fab = document.querySelector('.fab');
  if (emptyStateBtn && fab) {
    emptyStateBtn.addEventListener('click', function () { fab.click(); });
  }
})();
