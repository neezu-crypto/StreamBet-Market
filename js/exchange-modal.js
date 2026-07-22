(function () {
  var FEE_RATE = 0.10;
  var STEP = 10000;
  var DAILY_CAPS = [200000, 500000, 1000000];

  var openBtn = document.getElementById('open-exchange-modal');
  var backdrop = document.getElementById('exchange-backdrop');
  var closeBtn = document.getElementById('exchange-modal-close');
  var swapBtn = document.getElementById('exchange-swap-btn');
  var fromName = document.getElementById('exchange-from-name');
  var toName = document.getElementById('exchange-to-name');
  var fromBalanceEl = document.getElementById('exchange-from-balance');
  var amountInput = document.getElementById('exchange-amount-input');
  var minusBtn = document.getElementById('exchange-amount-minus');
  var plusBtn = document.getElementById('exchange-amount-plus');
  var maxBtn = document.getElementById('exchange-amount-max');
  var quickBtns = document.querySelectorAll('.exchange-quick-btn[data-amount]');
  var errorEl = document.getElementById('exchange-error');
  var feeEl = document.getElementById('exchange-fee');
  var netEl = document.getElementById('exchange-net');
  var limitText = document.getElementById('exchange-limit-text');
  var limitBar = document.getElementById('exchange-limit-bar');
  var submitBtn = document.getElementById('exchange-submit-btn');
  var statusEl = document.getElementById('exchange-status');
  if (!backdrop || !openBtn) return;

  var direction = 'toStock';
  var amount = 0;
  var walletBM = 0;
  var walletStock = 0;
  var dailyUsed = 0;
  var dailyCap = DAILY_CAPS[0];

  function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }

  function fromBalance() { return direction === 'toStock' ? walletBM : walletStock; }

  function updateDirectionUI() {
    if (direction === 'toStock') {
      fromName.textContent = '스트리머 배팅시장';
      toName.textContent = '스트리머 주식시장';
    } else {
      fromName.textContent = '스트리머 주식시장';
      toName.textContent = '스트리머 배팅시장';
    }
    fromBalanceEl.textContent = fmt(fromBalance()) + '원';
  }

  function updateLimitUI() {
    var pct = Math.min(100, Math.round((dailyUsed / dailyCap) * 100));
    limitText.textContent = fmt(dailyUsed) + ' / ' + fmt(dailyCap);
    limitBar.style.width = pct + '%';
    return dailyCap - dailyUsed;
  }

  function updateSummary() {
    var fee = amount * FEE_RATE;
    var net = amount - fee;
    feeEl.textContent = fmt(fee) + '원';
    netEl.textContent = fmt(net) + '원';
  }

  function setAmount(v) {
    v = Math.max(0, Math.round(v / STEP) * STEP);
    var remaining = updateLimitUI();
    var capped = Math.min(v, fromBalance(), Math.max(remaining, 0));
    amount = capped;
    amountInput.value = fmt(amount);

    if (v > fromBalance()) {
      errorEl.textContent = '보유 재화(' + fmt(fromBalance()) + '원)를 초과할 수 없습니다.';
      errorEl.classList.add('show');
    } else if (v > remaining) {
      errorEl.textContent = '오늘 남은 환전 한도(' + fmt(Math.max(remaining, 0)) + '원)를 초과할 수 없습니다.';
      errorEl.classList.add('show');
    } else {
      errorEl.classList.remove('show');
    }
    submitBtn.disabled = amount <= 0;
    updateSummary();
  }

  async function resetForm() {
    direction = 'toStock';
    statusEl.classList.remove('show');
    errorEl.classList.remove('show');
    submitBtn.textContent = '환전하기';

    amountInput.disabled = false;
    minusBtn.disabled = false;
    plusBtn.disabled = false;
    submitBtn.disabled = false;

    var fb = window.sbmFirebase;
    var uid = window.sbmRealUser.uid;
    var db = window.sbmDb;
    var walletSnap = await fb.get(fb.ref(db, 'bettingMarket/wallets/' + uid));
    // 지갑 문서가 아직 없으면(배팅시장 첫 이용) 서버가 처음 액션 시 1,000,000원으로 만들어주므로,
    // 화면에도 0원이 아니라 그 초기 자산을 그대로 보여줘야 한다 (07번).
    var wallet = walletSnap.val() || { balance: 1000000, accountCreatedAt: Date.now() };
    var cashSnap = await fb.get(fb.ref(db, 'users/' + uid + '/cash'));

    walletBM = wallet.balance || 0;
    walletStock = cashSnap.val() || 0;

    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    dailyUsed = wallet.dailyExchangeDate === today ? (wallet.dailyExchangeTotal || 0) : 0;
    var accountDay = Math.floor((Date.now() - (wallet.accountCreatedAt || Date.now())) / 86400000) + 1;
    dailyCap = accountDay <= 1 ? DAILY_CAPS[0] : accountDay === 2 ? DAILY_CAPS[1] : DAILY_CAPS[2];

    updateDirectionUI();
    setAmount(0);
  }

  function openModal() {
    if (!window.sbmRealUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    resetForm();
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  swapBtn.addEventListener('click', function () {
    direction = direction === 'toStock' ? 'toBettingMarket' : 'toStock';
    updateDirectionUI();
    setAmount(0);
  });

  minusBtn.addEventListener('click', function () { setAmount(amount - STEP); });
  plusBtn.addEventListener('click', function () { setAmount(amount + STEP); });
  maxBtn.addEventListener('click', function () {
    var remaining = updateLimitUI();
    setAmount(Math.min(fromBalance(), Math.max(remaining, 0)));
  });
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

    window.sbmFirebase.httpsCallable('exchangeCurrency')({ direction: direction, amount: amount })
      .then(function (res) {
        submitBtn.textContent = '환전 완료';
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = fmt(amount) + '원을 환전해 ' + toName.textContent + '에 ' + fmt(res.data.resultAmount) + '원이 지급됐습니다. (수수료 ' + fmt(res.data.fee) + '원)';
        statusEl.classList.add('show');
        resetForm();
      })
      .catch(function (err) {
        amountInput.disabled = false;
        minusBtn.disabled = false;
        plusBtn.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '환전하기';
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '환전 처리 중 오류가 발생했습니다.';
        statusEl.classList.add('show');
      });
  });
})();
