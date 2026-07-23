(function () {
  var BET_STEP = 10000;

  var backdrop = document.getElementById('bet-backdrop');
  var closeBtn = document.getElementById('bet-modal-close');
  var titleEl = document.getElementById('bet-modal-title');
  var proposerEl = document.getElementById('bet-modal-proposer');
  var outcomesEl = document.getElementById('bet-outcomes');
  var balanceEl = document.getElementById('bet-wallet-balance');
  var amountInput = document.getElementById('bet-amount-input');
  var minusBtn = document.getElementById('bet-amount-minus');
  var plusBtn = document.getElementById('bet-amount-plus');
  var maxBtn = document.getElementById('bet-amount-max');
  var quickBtns = document.querySelectorAll('.bet-quick-btn[data-amount]');
  var errorEl = document.getElementById('bet-error');
  var payoutEl = document.getElementById('bet-payout');
  var submitBtn = document.getElementById('bet-submit-btn');
  var statusEl = document.getElementById('bet-status');
  if (!backdrop) return;

  var amount = 0;
  var selectedOutcomeId = '';
  var selectedOdds = 0;
  var walletBalance = 0;
  var currentMarketId = '';
  var currentActiveBet = null; // { betId, amount, outcomeId }
  var openToken = 0; // openModal이 비동기로 진행되는 중 다른 마켓이 연달아 열리면 오래된 응답을 무시하기 위함

  function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }

  function renderOutcomes(market) {
    var odds = window.sbmComputeOdds(market);
    var outcomes = Object.keys(market.outcomes).map(function (id) {
      return Object.assign({ id: id }, market.outcomes[id]);
    });
    outcomesEl.innerHTML = '';
    outcomes.forEach(function (o, i) {
      var label = document.createElement('label');
      label.className = 'bet-outcome-option' + (i === 0 ? ' selected' : '');
      var oddsVal = odds[o.id] || 0;
      label.innerHTML =
        '<span class="label"><input type="radio" name="bet-outcome" ' + (i === 0 ? 'checked' : '') + '>' + sbmEscapeHtml(o.label) + '</span>' +
        '<span class="odd num">' + (oddsVal ? oddsVal.toFixed(2) : '-') + 'x</span>';
      label.querySelector('input').addEventListener('change', function () {
        outcomesEl.querySelectorAll('.bet-outcome-option').forEach(function (el) { el.classList.remove('selected'); });
        label.classList.add('selected');
        selectedOutcomeId = o.id;
        selectedOdds = oddsVal;
        updatePayout();
      });
      outcomesEl.appendChild(label);
    });
    selectedOutcomeId = outcomes[0] ? outcomes[0].id : '';
    selectedOdds = outcomes[0] ? (odds[outcomes[0].id] || 0) : 0;
  }

  function updatePayout() {
    payoutEl.textContent = fmt(amount * selectedOdds) + '원';
  }

  function setAmount(v) {
    v = Math.max(0, Math.round(v / BET_STEP) * BET_STEP);
    var capped = Math.min(v, walletBalance);
    amount = capped;
    amountInput.value = fmt(amount);
    if (v > walletBalance) {
      errorEl.textContent = '보유 재화(' + fmt(walletBalance) + '원)를 초과할 수 없습니다.';
      errorEl.classList.add('show');
    } else {
      errorEl.classList.remove('show');
    }
    submitBtn.disabled = amount <= 0;
    updatePayout();
  }

  async function openModal(marketId) {
    if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    var myToken = ++openToken;
    var fb = window.sbmFirebase;
    var market = window.sbmMarketsCache[marketId];
    if (!market) return;
    currentMarketId = marketId;
    currentActiveBet = null;
    titleEl.textContent = market.title;
    proposerEl.style.display = 'none';
    proposerEl.textContent = '';
    renderOutcomes(market);
    submitBtn.disabled = true;
    submitBtn.textContent = '배팅하기';
    statusEl.classList.remove('show');
    errorEl.classList.remove('show');
    amountInput.disabled = false;
    minusBtn.disabled = false;
    plusBtn.disabled = false;
    backdrop.classList.add('open');

    if (market.proposerUid) {
      fb.get(fb.ref(window.sbmDb, 'bettingMarket/profiles/' + market.proposerUid + '/nickname')).then(function (snap) {
        if (myToken !== openToken) return;
        var nickname = snap.val();
        proposerEl.innerHTML = '제안자: <b>' + sbmEscapeHtml(nickname || '알 수 없음') + '</b>';
        proposerEl.style.display = '';
      });
    }

    var walletSnap = await fb.get(fb.ref(window.sbmDb, 'bettingMarket/wallets/' + window.sbmUser.uid + '/balance'));
    if (myToken !== openToken) return; // 그 사이 다른 마켓이 열림 — 이 응답은 폐기
    // 지갑 문서가 아직 없으면(배팅시장 첫 이용) 서버가 처음 액션 시 1,000,000원으로 만들어주므로,
    // 화면에도 0원이 아니라 그 초기 자산을 그대로 보여줘야 한다 (07번).
    walletBalance = walletSnap.exists() ? walletSnap.val() : 1000000;
    balanceEl.textContent = fmt(walletBalance) + '원';

    var idxSnap = await fb.get(fb.ref(window.sbmDb, 'bettingMarket/userBets/' + window.sbmUser.uid + '/' + marketId));
    if (myToken !== openToken) return;
    var idx = idxSnap.val() || {};
    for (var betId in idx) {
      var betSnap = await fb.get(fb.ref(window.sbmDb, 'bettingMarket/bets/' + marketId + '/' + betId));
      if (myToken !== openToken) return;
      var bet = betSnap.val();
      if (bet && bet.status === 'active') {
        currentActiveBet = { betId: betId, amount: bet.amount, outcomeId: bet.outcomeId };
        statusEl.style.color = 'var(--gold)';
        statusEl.textContent = '이미 ' + fmt(bet.amount) + '원을 배팅 중입니다. 다시 배팅하면 기존 배팅을 취소하고 새로 배팅합니다(30초 쿨다운 적용).';
        statusEl.classList.add('show');
        break;
      }
    }
    if (myToken !== openToken) return;
    setAmount(0);
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-open-bet');
    if (!btn) return;
    e.stopPropagation();
    openModal(btn.getAttribute('data-market-id'));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  minusBtn.addEventListener('click', function () { setAmount(amount - BET_STEP); });
  plusBtn.addEventListener('click', function () { setAmount(amount + BET_STEP); });
  maxBtn.addEventListener('click', function () { setAmount(walletBalance); });
  quickBtns.forEach(function (b) {
    b.addEventListener('click', function () { setAmount(amount + parseInt(b.getAttribute('data-amount'), 10)); });
  });
  amountInput.addEventListener('change', function () {
    var raw = parseInt(amountInput.value.replace(/[^0-9]/g, ''), 10) || 0;
    setAmount(raw);
  });

  submitBtn.addEventListener('click', function () {
    if (amount <= 0 || !window.sbmFirebase) return;
    amountInput.disabled = true;
    minusBtn.disabled = true;
    plusBtn.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '처리중...';

    var fb = window.sbmFirebase;
    var chain = Promise.resolve();
    if (currentActiveBet) {
      chain = fb.httpsCallable('cancelBet')({ marketId: currentMarketId, betId: currentActiveBet.betId });
    }
    chain
      .then(function () {
        return fb.httpsCallable('placeBet')({ marketId: currentMarketId, outcomeId: selectedOutcomeId, amount: amount });
      })
      .then(function () {
        submitBtn.textContent = '배팅 완료';
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = fmt(amount) + '원 배팅이 접수됐습니다. 배팅 마감 전까지 취소 · 재배팅(30초 쿨다운)이 가능합니다.';
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        amountInput.disabled = false;
        minusBtn.disabled = false;
        plusBtn.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '배팅하기';
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '배팅 처리 중 오류가 발생했습니다.';
        statusEl.classList.add('show');
      });
  });
})();
