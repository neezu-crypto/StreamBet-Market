// 16번 — 스킨 탭. 카탈로그는 서버(functions/src/constants.js SKIN_CATALOG)와 동일하게
// 클라이언트에도 상수로 둔다(표시용 — 실제 가격 검증은 항상 서버가 한다).
var SBM_SKIN_CATALOG = {
  'excel-default': { name: '스프레드시트 테마', category: 'theme', price: 200000 },
  'win11-folder': { name: '탐색기 스타일 테마', category: 'theme', price: 200000 },
  'macos-finder': { name: '트래픽라이트 테마', category: 'theme', price: 200000 },
  'retro-pc': { name: '레트로 PC 테마', category: 'theme', price: 200000 },
  'spring-bloom': { name: '벚꽃 테마', category: 'theme', price: 200000 },
  'summer-ocean': { name: '오션 테마', category: 'theme', price: 200000 },
  'autumn-maple': { name: '단풍 테마', category: 'theme', price: 200000 },
  'winter-snow': { name: '스노우 테마', category: 'theme', price: 200000 },
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
    sbmUpdatePetals(skinId === 'spring-bloom');
  }

  // 벚꽃 테마 전용 낙화 배경 — DOM 노드는 딱 한 번만 만들고(개수 고정) 실제 낙하는
  // CSS @keyframes(transform/opacity만 사용)에 맡긴다. CSS 애니메이션은 프레임 수가
  // 아니라 경과 시간 기준으로 보간되므로 모니터 주사율과 무관하게 속도가 일정하고,
  // transform·opacity는 GPU 합성만으로 처리돼(레이아웃 재계산 없음) 저사양에서도
  // 프레임드랍이 적다. 바닥에 "쌓이는" 대신 화면 밖(115vh)까지 내려가며 서서히
  // 사라지도록 opacity를 함께 애니메이션한다.
  var sbmPetalLayer = null;
  function sbmUpdatePetals(shouldShow) {
    if (!shouldShow) {
      if (sbmPetalLayer) { sbmPetalLayer.remove(); sbmPetalLayer = null; }
      return;
    }
    if (sbmPetalLayer) return; // 이미 떠 있음
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var layer = document.createElement('div');
    layer.id = 'sbm-petal-layer';
    layer.setAttribute('aria-hidden', 'true');
    var count = window.innerWidth < 640 ? 10 : 18; // 좁은 화면(모바일)에선 더 가볍게
    for (var i = 0; i < count; i++) {
      // 바람(좌우로 일정하게 바뀌는 흔들림)과 낙하(속도 · 회전 · 수명)를 별개
      // 요소의 별개 애니메이션으로 분리한다 — 같은 요소의 transform 두 개는 서로
      // 합쳐지지 않고 덮어써지지만, 부모·자식 요소의 transform은 자연스럽게
      // 합성되므로 이렇게 감싸는 방식으로만 "함께 부는 바람" + "제각각인 낙하"를
      // 동시에 표현할 수 있다. 모든 꽃잎이 wind 애니메이션 지속시간 · 딜레이를
      // 공유해 같은 바람을 맞는 것처럼 동시에 좌우로 흔들린다.
      var wind = document.createElement('span');
      wind.className = 'sbm-petal-wind';
      wind.style.left = (Math.random() * 100).toFixed(1) + '%';

      var petal = document.createElement('span');
      petal.className = 'sbm-petal';
      var duration = (9 + Math.random() * 6).toFixed(2); // 9~15초, 낙하 속도는 이 값으로만 결정됨
      var delay = (Math.random() * duration).toFixed(2);
      var size = (7 + Math.random() * 6).toFixed(0) + 'px'; // 꽃잎 한 장 크기(이모지 대신 CSS 도형)
      petal.style.width = size;
      petal.style.height = size;
      petal.style.animationDuration = duration + 's';
      // 음수 delay로 시작해 로드 시점부터 이미 화면 곳곳에 흩날리고 있는 것처럼 보이게 한다.
      petal.style.animationDelay = '-' + delay + 's';
      petal.style.setProperty('--drift', (Math.random() * 30 - 15).toFixed(0) + 'px'); // 개별 미세 흔들림(큰 좌우 이동은 바람이 담당)
      petal.style.setProperty('--spin', (Math.random() < 0.5 ? '-' : '') + '360deg');

      wind.appendChild(petal);
      layer.appendChild(wind);
    }
    document.body.appendChild(layer);
    sbmPetalLayer = layer;
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

  // 시범 공개 중인 관리자 전용 스킨(예: 계절 테마 4종) — 관리자가 아니면 카테고리
  // 필터 조작과 무관하게 항상 숨겨야 하므로, style.display가 아니라 별도 클래스로
  // 게이팅한다(CSS 쪽 .skin-card[data-admin-only] 규칙 참고).
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
    updateAdminOnlyCards();
    if (unsubscribeOwned) { unsubscribeOwned(); unsubscribeOwned = null; }
    if (unsubscribeEquipped) { unsubscribeEquipped(); unsubscribeEquipped = null; }
    var user = e.detail.user;
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
