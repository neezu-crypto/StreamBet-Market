// 자산충전 — 보물상자 구매/열기. 개발자 라이브 방송 후원(룰렛) 방식 대신 SOOP
// 후원창(별풍선)으로 결제하고, 관리자가 실제 후원을 확인한 뒤 승인하면 보물상자가
// 지급된다. 지급된 보물상자는 "보물상자 열기"에서 하나씩 까서 자산을 받는다.
var SBM_CHEST_DONATION_URL = 'https://st.sooplive.com/app/gift_starballoon.php?szBjId=skftodwocks2&szWork=BJ_STATION&sys_type=web&location=station';
var SBM_CHEST_PRICE_PER_UNIT = 33;
var SBM_CHEST_BONUS_THRESHOLD = 10;
var SBM_CHEST_BONUS_RATE = 0.1;

var sbmChestRequestsCache = {};
var sbmChestRequestsSubscribed = false;

function sbmRenderChestPurchaseRequests() {
  var list = document.getElementById('chest-purchase-requests-list');
  if (!list || sbmChestRequestsSubscribed || !window.sbmFirebase) return;
  sbmChestRequestsSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/chestPurchaseRequests'), function (snap) {
    sbmChestRequestsCache = snap.val() || {};
    sbmRenderChestPurchaseRequestsList();
  });
}

function sbmRenderChestPurchaseRequestsList() {
  var list = document.getElementById('chest-purchase-requests-list');
  if (!list) return;
  var isAdmin = !!window.sbmIsAdmin;
  var reqs = Object.keys(sbmChestRequestsCache).map(function (id) { return Object.assign({ id: id }, sbmChestRequestsCache[id]); })
    .sort(function (a, b) { return b.requestedAt - a.requestedAt; });
  if (!reqs.length) {
    list.innerHTML = '<li class="audit-empty">대기 중인 보물상자 구매 신청이 없습니다.</li>';
    return;
  }
  list.innerHTML = reqs.map(function (r) {
    var bonusText = r.bonusQty ? ' (+보너스 ' + r.bonusQty + ')' : '';
    var detail = r.qty + '개' + bonusText + ' · 별풍선 ' + r.totalBalloons + '개';
    var actions = isAdmin
      ? '<button class="verify-req-approve chest-approve-btn" data-request-id="' + r.id + '" type="button">승인</button>' +
        '<button class="verify-req-reject chest-dismiss-btn" data-request-id="' + r.id + '" type="button">무시</button>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(r.nickname) + '</b><span>' + sbmEscapeHtml(detail) + ' · ' + new Date(r.requestedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + actions + '</div></li>';
  }).join('');

  list.querySelectorAll('.chest-approve-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var requestId = btn.getAttribute('data-request-id');
      var req = sbmChestRequestsCache[requestId];
      var detail = req ? (req.qty + '개(+보너스 ' + (req.bonusQty || 0) + ') · 별풍선 ' + req.totalBalloons + '개') : '';
      if (!confirm('후원을 확인하셨나요?\n' + detail + '\n승인하면 보물상자가 즉시 지급됩니다.')) return;
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('approveChestPurchase')({ requestId: requestId })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
  list.querySelectorAll('.chest-dismiss-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!confirm('이 구매 신청을 무시할까요? 지급 없이 신청 내역이 사라지며 복구할 수 없습니다.')) return;
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('dismissChestPurchase')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

document.addEventListener('sbm-auth-changed', sbmRenderChestPurchaseRequestsList);

(function () {
  var openBtn = document.getElementById('open-charge-modal');
  var choiceBackdrop = document.getElementById('charge-backdrop');
  var choiceCloseBtn = document.getElementById('charge-modal-close');
  var choiceBuyBtn = document.getElementById('chest-choice-buy-btn');
  var choiceOpenBtn = document.getElementById('chest-choice-open-btn');

  var buyBackdrop = document.getElementById('chest-buy-backdrop');
  var buyCloseBtn = document.getElementById('chest-buy-modal-close');
  var buyNicknameInput = document.getElementById('chest-buy-nickname');
  var buyErrorEl = document.getElementById('chest-buy-error');
  var buySubmitBtn = document.getElementById('chest-buy-submit-btn');
  var buyStatusEl = document.getElementById('chest-buy-status');
  var qtyValueEl = document.getElementById('chest-qty-value');
  var summaryQtyEl = document.getElementById('chest-summary-qty');
  var summaryBonusRowEl = document.getElementById('chest-summary-bonus-row');
  var summaryBonusEl = document.getElementById('chest-summary-bonus');
  var summaryTotalEl = document.getElementById('chest-summary-total');
  var summaryBalloonsEl = document.getElementById('chest-summary-balloons');

  var openBackdrop = document.getElementById('chest-open-backdrop');
  var openCloseBtn = document.getElementById('chest-open-modal-close');
  var openIconEl = document.getElementById('chest-open-icon');
  var openOwnedCountEl = document.getElementById('chest-open-owned-count');
  var openBtn2 = document.getElementById('chest-open-btn');
  var openResultEl = document.getElementById('chest-open-result');

  if (!openBtn || !choiceBackdrop) return;

  var allBackdrops = [choiceBackdrop, buyBackdrop, openBackdrop].filter(Boolean);
  function closeAll() { allBackdrops.forEach(function (b) { b.classList.remove('open'); }); }

  function openChoiceModal() {
    if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    closeAll();
    choiceBackdrop.classList.add('open');
  }

  var chestQty = 1;
  function sbmChestSummary(qty) {
    var bonusQty = qty >= SBM_CHEST_BONUS_THRESHOLD ? Math.floor(qty * SBM_CHEST_BONUS_RATE) : 0;
    return { qty: qty, bonusQty: bonusQty, totalQty: qty + bonusQty, totalBalloons: qty * SBM_CHEST_PRICE_PER_UNIT };
  }
  function renderChestSummary() {
    var s = sbmChestSummary(chestQty);
    qtyValueEl.textContent = chestQty;
    summaryQtyEl.textContent = s.qty + '개';
    if (s.bonusQty > 0) {
      summaryBonusRowEl.style.display = '';
      summaryBonusEl.textContent = '+' + s.bonusQty + '개';
    } else {
      summaryBonusRowEl.style.display = 'none';
    }
    summaryTotalEl.textContent = s.totalQty + '개';
    summaryBalloonsEl.textContent = s.totalBalloons.toLocaleString('ko-KR') + '개';
  }

  function openBuyModal() {
    closeAll();
    chestQty = 1;
    renderChestSummary();
    buyNicknameInput.value = '';
    buyNicknameInput.disabled = false;
    buyErrorEl.classList.remove('show');
    buyStatusEl.classList.remove('show');
    buySubmitBtn.disabled = false;
    buySubmitBtn.textContent = '구매하기';
    buyBackdrop.classList.add('open');
    buyNicknameInput.focus();
  }

  var sbmOwnedChestsUnsub = null;
  var sbmOwnedChestCount = 0;
  function sbmSubscribeOwnedChests() {
    if (sbmOwnedChestsUnsub || !window.sbmUser || !window.sbmFirebase) return;
    var fb = window.sbmFirebase;
    sbmOwnedChestsUnsub = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/ownedChests/' + window.sbmUser.uid), function (snap) {
      sbmOwnedChestCount = snap.val() || 0;
      openOwnedCountEl.textContent = sbmOwnedChestCount;
      openBtn2.disabled = sbmOwnedChestCount <= 0;
    });
  }
  document.addEventListener('sbm-auth-changed', function () {
    if (sbmOwnedChestsUnsub) { sbmOwnedChestsUnsub(); sbmOwnedChestsUnsub = null; }
    sbmOwnedChestCount = 0;
    if (window.sbmUser) sbmSubscribeOwnedChests();
  });

  function openOpenModal() {
    closeAll();
    openResultEl.style.display = 'none';
    openResultEl.textContent = '';
    openIconEl.textContent = '🎁';
    openIconEl.classList.remove('sbm-chest-shake');
    openBtn2.textContent = '열기';
    sbmSubscribeOwnedChests();
    openBtn2.disabled = sbmOwnedChestCount <= 0;
    openBackdrop.classList.add('open');
  }

  choiceCloseBtn.addEventListener('click', closeAll);
  buyCloseBtn.addEventListener('click', closeAll);
  openCloseBtn.addEventListener('click', closeAll);
  allBackdrops.forEach(function (b) {
    b.addEventListener('click', function (e) { if (e.target === b) closeAll(); });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && allBackdrops.some(function (b) { return b.classList.contains('open'); })) closeAll();
  });

  openBtn.addEventListener('click', openChoiceModal);
  choiceBuyBtn.addEventListener('click', openBuyModal);
  choiceOpenBtn.addEventListener('click', openOpenModal);

  // 구매 개수 스테퍼 — 1개/10개 단위로 증감, 최소 1개
  document.querySelectorAll('.chest-qty-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var step = parseInt(btn.getAttribute('data-step'), 10);
      chestQty = Math.max(1, chestQty + step);
      renderChestSummary();
    });
  });

  buySubmitBtn.addEventListener('click', function () {
    if (!window.sbmUser) {
      buyErrorEl.textContent = '구매하려면 로그인이 필요합니다.';
      buyErrorEl.classList.add('show');
      return;
    }
    var nickname = buyNicknameInput.value.trim();
    if (!nickname) {
      buyErrorEl.textContent = '닉네임을 입력해 주세요.';
      buyErrorEl.classList.add('show');
      return;
    }
    if (nickname.length > 20 || /[<>\x00-\x1F\x7F]/.test(nickname)) {
      buyErrorEl.textContent = '닉네임은 20자 이하, 사용할 수 없는 문자 없이 입력해 주세요.';
      buyErrorEl.classList.add('show');
      return;
    }
    buyErrorEl.classList.remove('show');
    buyNicknameInput.disabled = true;
    buySubmitBtn.disabled = true;
    buySubmitBtn.textContent = '신청 처리중...';

    window.sbmFirebase.httpsCallable('submitChestPurchase')({ nickname: nickname, qty: chestQty })
      .then(function () {
        buySubmitBtn.textContent = '신청 완료';
        buyStatusEl.style.color = 'var(--mint)';
        buyStatusEl.textContent = '신청이 접수됐습니다. 후원창에서 별풍선을 보내주시면, 관리자 확인 후 보물상자가 지급됩니다.';
        buyStatusEl.classList.add('show');
        window.open(SBM_CHEST_DONATION_URL, '_blank', 'noopener');
      })
      .catch(function (err) {
        buyNicknameInput.disabled = false;
        buySubmitBtn.disabled = false;
        buySubmitBtn.textContent = '구매하기';
        buyErrorEl.textContent = err.message || '신청 처리 중 오류가 발생했습니다.';
        buyErrorEl.classList.add('show');
      });
  });

  // 보물상자 열기 — 흔들리는 이펙트 + 반짝임을 잠깐 보여준 뒤 결과를 공개한다
  function sbmChestBurst() {
    var stage = openIconEl.parentElement;
    for (var i = 0; i < 10; i++) {
      var s = document.createElement('span');
      s.className = 'chest-open-spark';
      var angle = (Math.PI * 2 * i) / 10 + Math.random() * 0.4;
      var dist = 50 + Math.random() * 40;
      s.style.setProperty('--sbm-spark-x', (Math.cos(angle) * dist).toFixed(0) + 'px');
      s.style.setProperty('--sbm-spark-y', (Math.sin(angle) * dist).toFixed(0) + 'px');
      s.textContent = ['✨', '⭐', '💫'][i % 3];
      stage.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 700); })(s);
    }
  }

  openBtn2.addEventListener('click', function () {
    if (!window.sbmUser || sbmOwnedChestCount <= 0) return;
    openBtn2.disabled = true;
    openResultEl.style.display = 'none';
    openIconEl.classList.remove('sbm-chest-shake');
    void openIconEl.offsetWidth; // 애니메이션 재시작을 위한 리플로우 강제
    openIconEl.classList.add('sbm-chest-shake');
    sbmChestBurst();

    window.sbmFirebase.httpsCallable('openChest')({})
      .then(function (res) {
        var prize = (res && res.data && res.data.prize) || 0;
        setTimeout(function () {
          openIconEl.textContent = '💰';
          openResultEl.textContent = prize.toLocaleString('ko-KR') + '원 당첨!';
          openResultEl.style.display = '';
          openBtn2.disabled = sbmOwnedChestCount <= 0;
        }, 500);
      })
      .catch(function (err) {
        alert(err.message || '보물상자를 여는 중 오류가 발생했습니다.');
        openBtn2.disabled = sbmOwnedChestCount <= 0;
      });
  });
})();
