var sbmReportQueueSubscribed = false;

// 04번 — 관리자 · 인증 스트리머 모두 신고 접수함을 확인 · 처리할 수 있다.
function sbmRenderReportQueue() {
  var list = document.getElementById('report-queue-list');
  if (!list || sbmReportQueueSubscribed || !window.sbmFirebase) return;
  sbmReportQueueSubscribed = true;
  var fb = window.sbmFirebase;

  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/marketReports'), function (snap) {
    var val = snap.val() || {};
    var reports = Object.keys(val).map(function (id) { return Object.assign({ id: id }, val[id]); })
      .sort(function (a, b) { return b.reportedAt - a.reportedAt; });
    if (!reports.length) {
      list.innerHTML = '<li class="audit-empty">접수된 신고가 없습니다.</li>';
      return;
    }
    list.innerHTML = reports.map(function (r) {
      return '<li class="report-queue-item">' +
        '<div class="report-queue-head"><span class="report-queue-title">' + r.marketTitle + '</span><span class="report-queue-meta">' + r.reason + '</span></div>' +
        (r.detail ? '<div class="report-queue-detail">' + r.detail + '</div>' : '') +
        '<div class="audit-time">' + new Date(r.reportedAt).toLocaleString('ko-KR') + '</div>' +
        '<div class="report-queue-actions">' +
        '<button class="report-queue-view-btn" data-market-id="' + r.marketId + '" type="button">마켓 관리로 이동</button>' +
        '<button class="report-queue-dismiss-btn" data-report-id="' + r.id + '" type="button">확인 완료</button>' +
        '</div></li>';
    }).join('');

    list.querySelectorAll('.report-queue-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var marketId = btn.getAttribute('data-market-id');
        var card = document.querySelector('.js-manage-market[data-market-id="' + marketId + '"], .js-open-review[data-market-id="' + marketId + '"]');
        if (card) card.click();
      });
    });
    list.querySelectorAll('.report-queue-dismiss-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fn = fb.httpsCallable('dismissMarketReport');
        btn.disabled = true;
        fn({ reportId: btn.getAttribute('data-report-id') }).catch(function (e) { alert(e.message); btn.disabled = false; });
      });
    });
  });
}

(function () {
  var backdrop = document.getElementById('report-backdrop');
  var closeBtn = document.getElementById('report-modal-close');
  var targetTitleEl = document.getElementById('report-target-title');
  var reasonSelect = document.getElementById('report-reason');
  var detailInput = document.getElementById('report-detail');
  var submitBtn = document.getElementById('report-submit-btn');
  var statusEl = document.getElementById('report-status');
  if (!backdrop) return;

  var currentMarketId = '';
  var currentTitle = '';

  function openModal(marketId, title) {
    currentMarketId = marketId;
    currentTitle = title;
    targetTitleEl.textContent = title;
    reasonSelect.innerHTML = '';
    PROHIBITED_TOPIC_REASONS.concat(['기타']).forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      reasonSelect.appendChild(opt);
    });
    detailInput.value = '';
    detailInput.disabled = false;
    reasonSelect.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '신고하기';
    statusEl.classList.remove('show');
    backdrop.classList.add('open');
    if (!window.sbmRealUser) {
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = '신고하려면 로그인이 필요합니다 (Ctrl+Enter).';
      statusEl.classList.add('show');
      submitBtn.disabled = true;
    }
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-open-report');
    if (!btn) return;
    e.stopPropagation();
    openModal(btn.getAttribute('data-market-id'), btn.getAttribute('data-title'));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  submitBtn.addEventListener('click', function () {
    if (submitBtn.disabled || !window.sbmFirebase) return;
    reasonSelect.disabled = true;
    detailInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '신고 접수중...';
    var fn = window.sbmFirebase.httpsCallable('reportMarket');
    fn({ marketId: currentMarketId, reason: reasonSelect.value, detail: detailInput.value.trim() })
      .then(function () {
        submitBtn.textContent = '신고 완료';
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = '신고가 접수됐습니다. 관리자 · 인증 스트리머가 확인 후 처리합니다.';
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        submitBtn.textContent = '신고하기';
        submitBtn.disabled = false;
        reasonSelect.disabled = false;
        detailInput.disabled = false;
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '신고 처리 중 오류가 발생했습니다.';
        statusEl.classList.add('show');
      });
  });
})();
