// 10번 — "정산 내역" 탭: 본인의 모든 배팅 결과를 실데이터로 집계한다.
(function () {
  var listEl = document.getElementById('settlement-list');
  var countEl = document.getElementById('settlement-count');
  var totalBetEl = document.getElementById('settlement-total-bet');
  var totalPayoutEl = document.getElementById('settlement-total-payout');
  var netEl = document.getElementById('settlement-net');
  if (!listEl || !window.sbmFirebase) return;
  var fb = window.sbmFirebase;

  var marketTitles = {};
  var betEntries = {}; // key "marketId/betId" -> { marketId, betId, bet }
  var trackedKeys = {};

  function fmt(n) { return Math.round(n).toLocaleString('ko-KR'); }

  function render() {
    var entries = Object.keys(betEntries).map(function (k) { return betEntries[k]; })
      .filter(function (e) { return ['paid', 'lost', 'refunded'].indexOf(e.bet.status) > -1; })
      .sort(function (a, b) { return b.bet.placedAt - a.bet.placedAt; });

    var totalBet = 0, totalPayout = 0;
    entries.forEach(function (e) {
      totalBet += e.bet.amount;
      totalPayout += e.bet.status === 'paid' ? (e.bet.payout || 0) : e.bet.status === 'refunded' ? e.bet.amount : 0;
    });
    var net = totalPayout - totalBet;

    countEl.textContent = entries.length + '건';
    totalBetEl.textContent = fmt(totalBet) + '원';
    totalPayoutEl.textContent = fmt(totalPayout) + '원';
    netEl.textContent = (net >= 0 ? '+' : '') + fmt(net) + '원';
    netEl.className = 'value ' + (net > 0 ? 'positive' : net < 0 ? 'negative' : '');

    if (!entries.length) {
      listEl.innerHTML = '<div class="settlement-empty">아직 정산된 배팅 내역이 없습니다.</div>';
      return;
    }

    listEl.innerHTML = entries.map(function (e) {
      var title = marketTitles[e.marketId] || '마켓';
      var dateStr = new Date(e.bet.placedAt).toLocaleDateString('ko-KR');
      var badge, payoutClass, payoutText, netText;
      if (e.bet.status === 'paid') {
        badge = '<span class="settlement-badge win">적중</span>';
        payoutClass = 'positive';
        payoutText = fmt(e.bet.payout) + '원';
        netText = '순손익 ' + (e.bet.payout - e.bet.amount >= 0 ? '+' : '') + fmt(e.bet.payout - e.bet.amount) + '원';
      } else if (e.bet.status === 'refunded') {
        badge = '<span class="settlement-badge void">무효 · 환불</span>';
        payoutClass = 'neutral';
        payoutText = fmt(e.bet.amount) + '원';
        netText = '전액 환불';
      } else {
        badge = '<span class="settlement-badge lose">미적중</span>';
        payoutClass = 'negative';
        payoutText = '0원';
        netText = '순손익 −' + fmt(e.bet.amount) + '원';
      }
      return '<div class="settlement-item"><div class="settlement-item-main">' +
        '<div class="settlement-item-title">' + sbmEscapeHtml(title) + '</div>' +
        '<div class="settlement-item-meta"><span>' + dateStr + ' 정산</span><span>배팅 ' + fmt(e.bet.amount) + '원</span></div></div>' +
        '<div class="settlement-item-result">' + badge +
        '<div class="settlement-item-payout ' + payoutClass + '">' + payoutText + '</div>' +
        '<div class="settlement-item-net">' + netText + '</div></div></div>';
    }).join('');
  }

  function trackBet(marketId, betId) {
    var key = marketId + '/' + betId;
    if (trackedKeys[key]) return;
    trackedKeys[key] = true;
    if (!marketTitles[marketId]) {
      fb.get(fb.ref(window.sbmDb, 'bettingMarket/markets/' + marketId + '/title')).then(function (snap) {
        marketTitles[marketId] = snap.val() || '마켓';
        render();
      });
    }
    fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/bets/' + marketId + '/' + betId), function (snap) {
      if (!snap.exists()) return;
      betEntries[key] = { marketId: marketId, betId: betId, bet: snap.val() };
      render();
    });
  }

  document.addEventListener('sbm-auth-changed', function (e) {
    var user = e.detail.user;
    betEntries = {};
    trackedKeys = {};
    if (!user) {
      listEl.innerHTML = '<div class="settlement-empty">로그인하면 나의 배팅 정산 내역을 확인할 수 있습니다.</div>';
      countEl.textContent = '0건';
      totalBetEl.textContent = '0원';
      totalPayoutEl.textContent = '0원';
      netEl.textContent = '0원';
      return;
    }
    fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/userBets/' + user.uid), function (snap) {
      var val = snap.val() || {};
      Object.keys(val).forEach(function (marketId) {
        Object.keys(val[marketId]).forEach(function (betId) { trackBet(marketId, betId); });
      });
      render();
    });
  });
})();
