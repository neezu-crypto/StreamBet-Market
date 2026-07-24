// 16번 — 스킨 탭. 카탈로그는 서버(functions/src/constants.js SKIN_CATALOG)와 동일하게
// 클라이언트에도 상수로 둔다(표시용 — 실제 가격 검증은 항상 서버가 한다).
var SBM_SKIN_CATALOG = {
  'excel-default': { name: '엑셀 기본 테마', category: 'theme', price: 200000 },
  'win11-folder': { name: '윈도우11 폴더 스킨', category: 'theme', price: 200000 },
};

// 관리 탭 — 스킨 구매 내역. RTDB 규칙상 관리자·인증 스트리머만 읽을 수 있는 경로라
// 다른 관리 전용 목록(감사 로그 등)과 동일하게 구독 가드를 둔다.
var sbmSkinPurchaseLogSubscribed = false;
function sbmRenderSkinPurchaseLog() {
  var list = document.getElementById('skin-purchase-log-list');
  if (!list || sbmSkinPurchaseLogSubscribed || !window.sbmFirebase) return;
  sbmSkinPurchaseLogSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/skinPurchases'), function (snap) {
    var val = snap.val() || {};
    var entries = Object.keys(val).map(function (k) { return val[k]; })
      .sort(function (a, b) { return b.purchasedAt - a.purchasedAt; });
    list.innerHTML = entries.length ? entries.map(function (e) {
      return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(e.nickname || e.uid) + '</b>' +
        '<span>' + sbmEscapeHtml(e.skinName) + ' · ' + Math.round(e.price).toLocaleString('ko-KR') + '원 · ' +
        new Date(e.purchasedAt).toLocaleString('ko-KR') + '</span></div></li>';
    }).join('') : '<li class="audit-empty">구매 내역이 없습니다.</li>';
  });
}

(function () {
  var previewBar = document.getElementById('skin-preview-bar');
  var previewBarName = document.getElementById('skin-preview-bar-name');
  var previewExitBtn = document.getElementById('skin-preview-exit-btn');
  var cards = document.querySelectorAll('.skin-card[data-skin-id]');
  if (!cards.length) return;

  var ownedSkins = {};
  var equippedSkinId = '';
  var previewSkinId = ''; // 미리보기 중인 skinId, 없으면 ''

  // html 태그의 theme-* 클래스만 골라서 교체한다 — 다른 용도의 클래스는 건드리지 않는다.
  function setThemeClass(skinId) {
    var html = document.documentElement;
    var classes = (html.className || '').split(/\s+/).filter(function (c) { return c && c.indexOf('theme-') !== 0; });
    if (skinId) classes.push('theme-' + skinId);
    html.className = classes.join(' ');
  }

  function applyEquippedTheme() {
    if (previewSkinId) return; // 미리보기 중엔 실제 장착 테마로 되돌리지 않는다
    setThemeClass(equippedSkinId);
  }

  function startPreview(skinId) {
    previewSkinId = skinId;
    setThemeClass(skinId);
    if (previewBarName) previewBarName.textContent = (SBM_SKIN_CATALOG[skinId] || {}).name || skinId;
    if (previewBar) previewBar.style.display = '';
  }
  function exitPreview() {
    if (!previewSkinId) return;
    previewSkinId = '';
    setThemeClass(equippedSkinId);
    if (previewBar) previewBar.style.display = 'none';
  }
  if (previewExitBtn) previewExitBtn.addEventListener('click', exitPreview);

  function renderSkinCards() {
    cards.forEach(function (card) {
      var skinId = card.getAttribute('data-skin-id');
      var owned = !!ownedSkins[skinId];
      var equipped = equippedSkinId === skinId;
      card.classList.toggle('owned', owned && !equipped);
      card.classList.toggle('equipped', equipped);
      var buyBtn = card.querySelector('.skin-buy-btn');
      if (!buyBtn) return;
      buyBtn.classList.toggle('owned', owned && !equipped);
      buyBtn.classList.toggle('equipped', equipped);
      buyBtn.textContent = equipped ? '해제하기' : (owned ? '장착하기' : '구매하기');
    });
  }

  cards.forEach(function (card) {
    var skinId = card.getAttribute('data-skin-id');
    var skin = SBM_SKIN_CATALOG[skinId];
    var buyBtn = card.querySelector('.skin-buy-btn');
    var previewBtn = card.querySelector('.skin-preview-btn');

    if (previewBtn) {
      previewBtn.addEventListener('click', function () { startPreview(skinId); });
    }

    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
        if (!window.sbmFirebase) return;
        var owned = !!ownedSkins[skinId];
        var equipped = equippedSkinId === skinId;
        var fnName, payload;
        if (equipped) {
          fnName = 'equipSkin';
          payload = { skinId: null };
        } else if (owned) {
          fnName = 'equipSkin';
          payload = { skinId: skinId };
        } else {
          var price = (skin && skin.price) || 0;
          if (!confirm((skin ? skin.name : skinId) + '을(를) ' + price.toLocaleString('ko-KR') + '원에 구매할까요?')) return;
          fnName = 'purchaseSkin';
          payload = { skinId: skinId };
        }
        buyBtn.disabled = true;
        window.sbmFirebase.httpsCallable(fnName)(payload)
          .catch(function (e) { alert(e.message); })
          .then(function () { buyBtn.disabled = false; });
      });
    }
  });

  // 시범 공개 중인 관리자 전용 스킨(예: 윈도우11 폴더 스킨) — 관리자가 아니면
  // 카테고리 필터 조작과 무관하게 항상 숨겨야 하므로, style.display가 아니라
  // 별도 클래스로 게이팅한다(CSS 쪽 .skin-card[data-admin-only] 규칙 참고).
  function updateAdminOnlyCards() {
    var isAdmin = !!window.sbmIsAdmin;
    cards.forEach(function (card) {
      if (card.hasAttribute('data-admin-only')) {
        card.classList.toggle('sbm-admin-visible', isAdmin);
      }
    });
  }

  var unsubscribeOwned = null;
  var unsubscribeEquipped = null;
  document.addEventListener('sbm-auth-changed', function (e) {
    if (unsubscribeOwned) { unsubscribeOwned(); unsubscribeOwned = null; }
    if (unsubscribeEquipped) { unsubscribeEquipped(); unsubscribeEquipped = null; }
    var user = e.detail.user;
    updateAdminOnlyCards();
    ownedSkins = {};
    equippedSkinId = '';
    exitPreview();
    renderSkinCards();
    if (!user || !window.sbmFirebase) { setThemeClass(''); return; }

    var fb = window.sbmFirebase;
    unsubscribeOwned = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/ownedSkins/' + user.uid), function (snap) {
      ownedSkins = snap.val() || {};
      renderSkinCards();
    });
    unsubscribeEquipped = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/equippedSkin/' + user.uid), function (snap) {
      equippedSkinId = snap.val() || '';
      renderSkinCards();
      applyEquippedTheme();
    });
  });
})();
