document.addEventListener('click', function (e) {
  document.querySelectorAll('details.dev-dropdown[open]').forEach(function (d) {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});

(function () {
  var resetBtn = document.getElementById('reset-cache-btn');
  if (!resetBtn) return;
  resetBtn.addEventListener('click', function () {
    Object.keys(localStorage)
      .filter(function (k) { return k.indexOf('sbm_cache_') === 0; })
      .forEach(function (k) { localStorage.removeItem(k); });
    location.reload();
  });
})();

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
  var EMPTY_KEY = 'sbm_demo_empty';
  var btn = document.getElementById('demo-empty-btn');
  var heroSection = document.getElementById('feed-hero-section');
  var openSection = document.getElementById('feed-open-section');
  var pendingSection = document.getElementById('feed-pending-section');
  var emptyState = document.getElementById('feed-empty-state');
  if (!heroSection || !openSection || !pendingSection || !emptyState) return;

  var isEmpty = sessionStorage.getItem(EMPTY_KEY) === '1';
  if (isEmpty) {
    heroSection.style.display = 'none';
    openSection.style.display = 'none';
    pendingSection.style.display = 'none';
    emptyState.style.display = '';
  }

  var emptyStateBtn = document.getElementById('empty-state-propose-btn');
  var fab = document.querySelector('.fab');
  if (emptyStateBtn && fab) {
    emptyStateBtn.addEventListener('click', function () { fab.click(); });
  }

  if (btn) {
    btn.textContent = isEmpty ? '빈 마켓 상태 해제' : '빈 마켓 상태 테스트';
    btn.addEventListener('click', function () {
      if (sessionStorage.getItem(EMPTY_KEY) === '1') {
        sessionStorage.removeItem(EMPTY_KEY);
      } else {
        sessionStorage.setItem(EMPTY_KEY, '1');
      }
      location.reload();
    });
  }
})();
