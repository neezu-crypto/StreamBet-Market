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

  // 벚꽃 테마 — 배경 레이어 전체에 이미 두껍게 쌓인 꽃잎 카펫 + 마우스가 지나갈 때
  // 그 자리를 낙엽 치우는 강풍기처럼 쓸어버리는 효과. 개수가 많고(전체 화면을
  // 덮는 밀도) 매 프레임 물리 연산(스프링 복귀 + 감쇠)이 필요해 DOM 엘리먼트
  // 대신 <canvas> 2D 렌더링을 쓴다 — 수백 개의 style 변경보다 캔버스 draw 호출이
  // 훨씬 가볍다. 물리는 경과 시간(dtFactor, 60fps 기준 정규화)으로 적분해
  // 모니터 주사율과 무관하게 같은 속도로 움직인다.
  var sbmPetalCanvas = null;
  var sbmPetalCtx = null;
  var sbmPetalParticles = null;
  var sbmPetalRAF = null;
  var sbmPetalLastT = 0;
  var sbmPetalReducedMotion = false;
  var sbmPetalMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var SBM_PETAL_COLORS = ['#ffd9e8', '#f7b8d1', '#f4a6c6', '#e386ab'];
  var SBM_PETAL_BLOW_RADIUS = 150;

  function sbmPetalSeed() {
    var w = window.innerWidth, h = window.innerHeight;
    var count = Math.min(320, Math.max(60, Math.round((w * h) / 9000)));
    if (w < 640) count = Math.round(count * 0.55); // 모바일에선 더 가볍게
    var particles = [];
    for (var i = 0; i < count; i++) {
      var hx = Math.random() * w;
      var hy = Math.random() * h; // 배경 레이어 전체에 골고루 쌓여있는 상태
      particles.push({
        hx: hx, hy: hy,
        x: hx, y: hy,
        vx: 0, vy: 0,
        r: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: 0,
        color: SBM_PETAL_COLORS[(Math.random() * SBM_PETAL_COLORS.length) | 0]
      });
    }
    sbmPetalParticles = particles;
  }

  function sbmPetalResize() {
    if (!sbmPetalCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    sbmPetalCanvas.width = Math.round(window.innerWidth * dpr);
    sbmPetalCanvas.height = Math.round(window.innerHeight * dpr);
    sbmPetalCanvas.style.width = window.innerWidth + 'px';
    sbmPetalCanvas.style.height = window.innerHeight + 'px';
    sbmPetalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmPetalSeed();
    sbmPetalDraw();
  }

  // 마우스 이동 속도(직전 위치 대비 변위/경과시간)를 추적 — 빠르게 움직일수록
  // "강풍"이 세지고, 멈춰있으면(속도 0에 가까워지면) 꽃잎도 다시 잠잠해진다.
  function sbmPetalTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmPetalMouse.t);
    sbmPetalMouse.vx = (x - sbmPetalMouse.x) / dt * 16.67;
    sbmPetalMouse.vy = (y - sbmPetalMouse.y) / dt * 16.67;
    sbmPetalMouse.x = x;
    sbmPetalMouse.y = y;
    sbmPetalMouse.t = now;
  }
  function sbmPetalOnMouseMove(e) { sbmPetalTrackPointer(e.clientX, e.clientY); }
  function sbmPetalOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmPetalTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmPetalStep(dtFactor) {
    var particles = sbmPetalParticles;
    if (!particles) return;
    var mx = sbmPetalMouse.x, my = sbmPetalMouse.y;
    var speed = Math.sqrt(sbmPetalMouse.vx * sbmPetalMouse.vx + sbmPetalMouse.vy * sbmPetalMouse.vy);
    var blowing = speed > 1.2;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (blowing) {
        var dx = p.x - mx, dy = p.y - my;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        if (dist < SBM_PETAL_BLOW_RADIUS) {
          // 마우스 위치에서 바깥쪽(마우스의 반대 방향)으로 밀어내는 힘 — 가까울수록,
          // 마우스가 빠르게 움직일수록 세게 흩날린다(강풍기로 쓸어버리는 느낌).
          var force = (1 - dist / SBM_PETAL_BLOW_RADIUS) * Math.min(speed, 40) * 0.35;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
          p.vr += (Math.random() - 0.5) * 0.15;
        }
      }
      // 원래 쌓여있던 자리로 서서히 되돌아오는 약한 스프링 힘 + 감쇠(공기 저항)
      p.vx += (p.hx - p.x) * 0.006;
      p.vy += (p.hy - p.y) * 0.006;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.vr *= 0.94;

      p.x += p.vx * dtFactor;
      p.y += p.vy * dtFactor;
      p.rot += p.vr * dtFactor;
    }
    // 마우스가 멈추면 "체감 속도"도 같이 잦아들게 매 프레임 감쇠
    sbmPetalMouse.vx *= 0.85;
    sbmPetalMouse.vy *= 0.85;
  }

  function sbmPetalDraw() {
    if (!sbmPetalCtx || !sbmPetalParticles) return;
    var ctx = sbmPetalCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = 0; i < sbmPetalParticles.length; i++) {
      var p = sbmPetalParticles[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function sbmPetalLoop(t) {
    if (!sbmPetalCanvas) return;
    var dtMs = sbmPetalLastT ? (t - sbmPetalLastT) : 16.67;
    sbmPetalLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67); // 탭 전환 복귀 등으로 dt가 튀어도 한 번에 과하게 점프하지 않도록 상한
    sbmPetalStep(dtFactor);
    sbmPetalDraw();
    sbmPetalRAF = requestAnimationFrame(sbmPetalLoop);
  }

  function sbmUpdatePetals(shouldShow) {
    if (!shouldShow) {
      if (sbmPetalRAF) { cancelAnimationFrame(sbmPetalRAF); sbmPetalRAF = null; }
      if (sbmPetalCanvas) { sbmPetalCanvas.remove(); sbmPetalCanvas = null; sbmPetalCtx = null; }
      window.removeEventListener('mousemove', sbmPetalOnMouseMove);
      window.removeEventListener('touchmove', sbmPetalOnTouchMove);
      window.removeEventListener('resize', sbmPetalResize);
      sbmPetalParticles = null;
      sbmPetalLastT = 0;
      return;
    }
    if (sbmPetalCanvas) return; // 이미 떠 있음
    sbmPetalReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmPetalCanvas = document.createElement('canvas');
    sbmPetalCanvas.id = 'sbm-petal-layer';
    sbmPetalCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmPetalCanvas);
    sbmPetalCtx = sbmPetalCanvas.getContext('2d');
    sbmPetalResize(); // 크기 지정 + 화면 전체에 꽃잎 카펫 시딩 + 첫 프레임 렌더

    if (sbmPetalReducedMotion) return; // 정적 카펫만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmPetalOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmPetalOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmPetalResize);
    sbmPetalLastT = 0;
    sbmPetalRAF = requestAnimationFrame(sbmPetalLoop);
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
