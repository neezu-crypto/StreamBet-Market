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

  navMarket.addEventListener('click', function (e) { e.preventDefault(); showTab(tabs[0]); });
  navAdmin.addEventListener('click', function (e) {
    e.preventDefault();
    showTab(tabs[1]);
    sbmRenderAuditLog();
    sbmRenderVerifyRequests();
    sbmRenderVerifiedStreamers();
    sbmRenderReportQueue();
    sbmRenderNicknameReportQueue();
    sbmRenderBlockedNicknames();
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
