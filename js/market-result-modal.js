// 16번 — 마감된 마켓 결과 모달. 관리자·인증 스트리머 전용인 review-modal/manage-modal과
// 달리 이 모달은 로그인 여부·권한과 무관하게 누구나 열 수 있고, 읽기 전용이다(액션 버튼 없음).
// 정산완료(settled)/무효(void) 마켓 데이터는 이미 js/market-feed.js가 sbmMarketsCache에
// 받아둔 상태라 별도 fetch 없이 그대로 재사용한다.
(function () {
  var backdrop = document.getElementById('market-result-backdrop');
  var closeBtn = document.getElementById('market-result-modal-close');
  var tagEl = document.getElementById('market-result-tag');
  var titleEl = document.getElementById('market-result-title');
  var metaEl = document.getElementById('market-result-meta');
  var outcomesEl = document.getElementById('market-result-outcomes');
  var summaryEl = document.getElementById('market-result-summary');
  if (!backdrop) return;

  function openModal(marketId) {
    var market = (window.sbmMarketsCache && window.sbmMarketsCache[marketId]) || {};
    var isVoid = market.status === 'void';
    var total = market.totalPool || 0;
    var winningOutcomeId = market.settlement ? market.settlement.winningOutcomeId : null;

    titleEl.textContent = market.title || '';
    tagEl.textContent = isVoid ? '무효 처리' : '정산 완료';

    var settledAt = market.settlement ? market.settlement.settledAt : (market.adminAction ? market.adminAction.at : null);
    var dateText = settledAt ? new Date(settledAt).toLocaleString('ko-KR') : '-';
    metaEl.innerHTML = sbmTypeLabel(market.type) + '<br>' + dateText + ' 정산 · 총 풀 ' + sbmFmtNum(total) + '원';

    var outcomes = sbmOutcomeArray(market);
    outcomesEl.innerHTML = outcomes.map(function (o) {
      var pool = o.pool || 0;
      var pct = total > 0 ? Math.round((pool / total) * 100) : 0;
      var isWin = !isVoid && o.id === winningOutcomeId;
      return '<div class="market-result-outcome' + (isWin ? ' win' : '') + '">' +
        '<span class="name">' + sbmEscapeHtml(o.label) + '</span>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
        '<span class="amount">' + sbmFmtNum(pool) + '원 · ' + pct + '%</span>' +
        (isWin ? '<span class="win-tag">적중</span>' : '') +
        '</div>';
    }).join('');

    if (isVoid) {
      summaryEl.textContent = '무효 처리 — ' + ((market.adminAction && market.adminAction.reason) || '전액 환불') + ' (배팅 원금 전액 반환)';
    } else if (market.settlement) {
      var winLabel = (market.outcomes && market.outcomes[winningOutcomeId] && market.outcomes[winningOutcomeId].label) || '';
      summaryEl.textContent = '"' + winLabel + '" 적중 · 확정 배당 ' + market.settlement.payoutMultiplier.toFixed(2) + '배 지급';
    } else {
      summaryEl.textContent = '';
    }

    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.js-open-result');
    if (!card) return;
    openModal(card.getAttribute('data-market-id'));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
})();
