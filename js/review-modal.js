(function () {
  var backdrop = document.getElementById('review-backdrop');
  var closeBtn = document.getElementById('review-modal-close');
  var titleEl = document.getElementById('review-modal-title');
  var metaEl = document.getElementById('review-meta');
  var approveBtn = document.getElementById('review-approve-btn');
  var rejectBtn = document.getElementById('review-reject-btn');
  var statusEl = document.getElementById('review-status');
  var overrideLikes = document.getElementById('review-override-likes');
  var overrideParticipants = document.getElementById('review-override-participants');
  if (!backdrop) return;

  var currentMarketId = '';

  function openModal(marketId) {
    currentMarketId = marketId;
    var market = window.sbmMarketsCache[marketId] || {};
    titleEl.textContent = market.title || '';
    var likeCount = (market.validation && market.validation.likeCount) || 0;
    var passed = likeCount >= SBM_LIKE_THRESHOLD;
    metaEl.innerHTML = sbmTypeLabel(market.type) +
      '<br>현재 좋아요 ' + likeCount + ' / ' + SBM_LIKE_THRESHOLD + (passed ? ' (자동 통과 기준 충족)' : ' (자동 통과 기준 미달)');
    statusEl.classList.remove('show');
    var canReview = window.sbmIsAdmin || window.sbmIsVerifiedStreamer;
    approveBtn.disabled = !canReview;
    rejectBtn.disabled = !canReview;
    if (!canReview) {
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = '관리자 또는 인증 스트리머만 검수할 수 있습니다.';
      statusEl.classList.add('show');
    }
    overrideLikes.checked = false;
    overrideParticipants.checked = false;
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.js-open-review');
    if (!card || e.target.closest('.stub-foot-actions')) return;
    openModal(card.getAttribute('data-market-id'));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  function review(action) {
    if (!window.sbmFirebase) return;
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    statusEl.style.color = 'var(--gold)';
    statusEl.textContent = '처리중...';
    statusEl.classList.add('show');
    window.sbmFirebase.httpsCallable('reviewProposal')({
      marketId: currentMarketId,
      action: action,
      overrideLikes: overrideLikes.checked,
      overrideParticipants: overrideParticipants.checked,
    }).then(function () {
      statusEl.style.color = action === 'approve' ? 'var(--mint)' : 'var(--coral)';
      statusEl.textContent = action === 'approve' ? '승인되었습니다. 배팅이 오픈됩니다.' : '반려되었습니다.';
    }).catch(function (err) {
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = err.message || '처리 중 오류가 발생했습니다.';
      approveBtn.disabled = false;
      rejectBtn.disabled = false;
    });
  }
  approveBtn.addEventListener('click', function () { review('approve'); });
  rejectBtn.addEventListener('click', function () { review('reject'); });
})();
