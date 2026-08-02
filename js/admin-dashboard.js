// 관리 탭 — 대시보드 요약 / 이상 거래 모니터링 / 환전 내역(관리자·인증 스트리머 공통),
// 유저 검색 · 수동 잔액 조정 · 계정 정지(관리자 전용).
var sbmBannedAccountsCache = {};
var sbmBannedListSubscribed = false;

function sbmRenderAdminDashboard() {
  var circEl = document.getElementById('stat-circulation');
  if (!circEl || !window.sbmFirebase) return;
  window.sbmFirebase.httpsCallable('getAdminDashboardStats')({}).then(function (res) {
    var d = res.data;
    // 오늘
    document.getElementById('stat-new-wallets').textContent = d.newWalletsToday + '개';
    document.getElementById('stat-active-markets').textContent = d.activeMarkets + '개';
    document.getElementById('stat-bet-today').textContent = sbmFmtNum(d.totalBetAmountToday) + '원 · ' + d.totalBetCountToday + '건';
    // 회원 구성
    document.getElementById('stat-total-wallets').textContent = d.totalWallets + '개';
    document.getElementById('stat-anonymous').textContent = d.anonymousCount + '명';
    document.getElementById('stat-real-users').textContent = d.realCount + '명';
    document.getElementById('stat-verified-streamers').textContent = d.verifiedStreamerCount + '명';
    // 누적
    document.getElementById('stat-bet-alltime').textContent = sbmFmtNum(d.totalBetAmountAllTime) + '원 · ' + d.totalBetCountAllTime + '건';
    document.getElementById('stat-avg-bet').textContent = sbmFmtNum(d.avgBetAmount) + '원';
    document.getElementById('stat-avg-balance').textContent = sbmFmtNum(d.avgWalletBalance) + '원';
    document.getElementById('stat-settled').textContent = (d.settledCount + d.voidCount) + '건 · 무효 ' + d.voidRatePercent + '%';
    document.getElementById('stat-payout-alltime').textContent = sbmFmtNum(d.totalPayoutAllTime) + '원';
    document.getElementById('stat-exchange-alltime').textContent = sbmFmtNum(d.totalExchangeAmountAllTime) + '원';
    document.getElementById('stat-rake-alltime').textContent = sbmFmtNum(d.totalRakeCollected) + '원';
    document.getElementById('stat-jackpot-wins').textContent = d.jackpotWinCount + '회 · ' + sbmFmtNum(d.jackpotTotalPaid) + '원';
    document.getElementById('stat-attendance').textContent = d.attendanceParticipantCount + '명';
    // 재무 건전성
    circEl.textContent = sbmFmtNum(d.totalCirculation) + '원';
    document.getElementById('stat-reserve').textContent = sbmFmtNum(d.reserveFundBalance) + '원';
    document.getElementById('stat-jackpot-balance').textContent = sbmFmtNum(d.jackpotBalance) + '원';
  }).catch(function (e) { circEl.textContent = '오류: ' + e.message; });
}

var sbmStatsChartState = { granularity: 'day', metric: 'betAmount' };

function sbmRenderStatsChart() {
  var box = document.getElementById('stats-chart-box');
  if (!box || !window.sbmFirebase) return;
  box.innerHTML = '<div class="admin-item-sub" style="padding:24px 0;text-align:center;">불러오는 중...</div>';
  window.sbmFirebase.httpsCallable('getStatsTimeseries')({ granularity: sbmStatsChartState.granularity })
    .then(function (res) {
      sbmDrawStatsChart(box, res.data.series, sbmStatsChartState.metric);
    })
    .catch(function (e) {
      box.innerHTML = '<div class="admin-item-sub" style="padding:24px 0;text-align:center;">오류: ' + sbmEscapeHtml(e.message) + '</div>';
    });
}

function sbmDrawStatsChart(box, series, metric) {
  if (!series || !series.length) {
    box.innerHTML = '<div class="admin-item-sub" style="padding:24px 0;text-align:center;">데이터가 없습니다.</div>';
    return;
  }
  var values = series.map(function (s) { return s[metric] || 0; });
  var max = Math.max.apply(null, values.concat([1]));

  var isMoney = metric === 'betAmount';
  function fmtValue(v) {
    if (!v) return '0';
    if (isMoney) return v >= 10000 ? Math.round(v / 10000) + '만' : sbmFmtNum(v);
    return sbmFmtNum(v);
  }
  function fmtLabel(label) {
    // day: YYYY-MM-DD → MM/DD, week: YYYY-MM-DD(월요일) → MM/DD주, month: YYYY-MM → MM월
    var parts = label.split('-');
    if (parts.length === 3) return parts[1] + '/' + parts[2] + (sbmStatsChartState.granularity === 'week' ? '주' : '');
    return parts[1] + '월';
  }

  var cols = series.map(function (s) {
    var v = s[metric] || 0;
    var hPercent = max > 0 ? Math.round((v / max) * 100) : 0;
    return '<div class="stats-chart-col">' +
      '<div class="stats-chart-value">' + fmtValue(v) + '</div>' +
      '<div class="stats-chart-bar-wrap"><div class="stats-chart-bar" style="height:' + hPercent + '%;"></div></div>' +
      '<div class="stats-chart-label">' + fmtLabel(s.label) + '</div>' +
      '</div>';
  }).join('');

  box.innerHTML = '<div class="stats-chart-bars">' + cols + '</div>';
}

function sbmRenderAnomalyMonitor() {
  var summaryEl = document.getElementById('anomaly-summary');
  if (!summaryEl || !window.sbmFirebase) return;
  window.sbmFirebase.httpsCallable('getAnomalyMonitor')({}).then(function (res) {
    var d = res.data;
    summaryEl.innerHTML = '최근 1시간 신규 지갑 <b>' + d.recentWalletsCount + '개</b> · ' +
      '최근 24시간 환전 <b>' + sbmFmtNum(d.exchangeAmount24h) + '원</b>(' + d.exchangeCount24h + '건)';

    var walletsEl = document.getElementById('anomaly-recent-wallets');
    walletsEl.innerHTML = d.recentWallets.length ? d.recentWallets.map(function (w) {
      return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(w.nickname || w.uid) + '</b>' +
        '<span>잔액 ' + sbmFmtNum(w.balance) + '원 · ' + new Date(w.accountCreatedAt).toLocaleString('ko-KR') + '</span></div></li>';
    }).join('') : '<li class="audit-empty">최근 1시간 내 생성된 지갑이 없습니다.</li>';

    var topEl = document.getElementById('anomaly-top-balances');
    topEl.innerHTML = d.topBalances.length ? d.topBalances.map(function (w, i) {
      return '<li class="verify-req-item"><div class="verify-req-info"><b>' + (i + 1) + '. ' + sbmEscapeHtml(w.nickname || w.uid) + '</b>' +
        '<span>' + sbmFmtNum(w.balance) + '원</span></div></li>';
    }).join('') : '<li class="audit-empty">데이터가 없습니다.</li>';
  }).catch(function (e) { summaryEl.textContent = '오류: ' + e.message; });
}

function sbmRenderExchangeLog() {
  var listEl = document.getElementById('exchange-log-list');
  if (!listEl || !window.sbmFirebase) return;
  window.sbmFirebase.httpsCallable('getExchangeLog')({}).then(function (res) {
    var entries = res.data.entries;
    listEl.innerHTML = entries.length ? entries.map(function (e) {
      var dirLabel = e.direction === 'toStock' ? '배팅재화 → 주식캐시' : '주식캐시 → 배팅재화';
      return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(e.nickname || e.uid) + '</b>' +
        '<span>' + dirLabel + ' · ' + sbmFmtNum(e.amount) + '원(수수료 ' + sbmFmtNum(e.fee) + '원) · ' +
        new Date(e.requestedAt).toLocaleString('ko-KR') + '</span></div></li>';
    }).join('') : '<li class="audit-empty">환전 내역이 없습니다.</li>';
  }).catch(function (e) { listEl.innerHTML = '<li class="audit-empty">오류: ' + sbmEscapeHtml(e.message) + '</li>'; });
}

// 20번 2단계 — 공유 bannedAccounts/{uid} 원장에서 이 저장소(bettingMarket) 관점의
// 정지만 골라 보여준다. all:true(전체 게임 정지)는 통합 관리 센터에서만 해제할 수
// 있으므로 여기선 안내만 하고 정지 해제 버튼을 주지 않는다(눌러도 games.bettingMarket만
// 지워질 뿐 전체 정지는 그대로 남아 혼란만 줄 수 있음).
function sbmRenderBannedAccounts() {
  var listEl = document.getElementById('banned-accounts-list');
  if (!listEl) return;
  var isAdmin = !!window.sbmIsAdmin;
  var entries = Object.keys(sbmBannedAccountsCache).map(function (uid) {
    var ban = sbmBannedAccountsCache[uid];
    if (ban.all) return { uid: uid, reason: ban.allReason, bannedAt: ban.allBannedAt, all: true };
    if (ban.games && ban.games.bettingMarket) return Object.assign({ uid: uid, all: false }, ban.games.bettingMarket);
    return null;
  }).filter(Boolean);
  if (!entries.length) {
    listEl.innerHTML = '<li class="audit-empty">정지된 계정이 없습니다.</li>';
    return;
  }
  listEl.innerHTML = entries.map(function (b) {
    var unbanBtn = isAdmin && !b.all
      ? '<button class="verify-req-reject admin-unban-btn" data-uid="' + b.uid + '" type="button">정지 해제</button>'
      : (b.all ? '<span class="audit-empty" style="padding:0;">전체 게임 정지(통합 관리 센터에서 해제)</span>' : '');
    return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(b.uid) + '</b>' +
      '<span>' + sbmEscapeHtml(b.reason || '') + ' · ' + new Date(b.bannedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + unbanBtn + '</div></li>';
  }).join('');

  listEl.querySelectorAll('.admin-unban-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var uid = btn.getAttribute('data-uid');
      if (!confirm('이 계정(' + uid + ')의 정지를 해제할까요?')) return;
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('unbanAccount')({ uid: uid })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

function sbmSubscribeBannedAccounts() {
  if (sbmBannedListSubscribed || !window.sbmFirebase) return;
  sbmBannedListSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bannedAccounts'), function (snap) {
    sbmBannedAccountsCache = snap.val() || {};
    sbmRenderBannedAccounts();
  });
}

(function () {
  var input = document.getElementById('admin-lookup-input');
  var btn = document.getElementById('admin-lookup-btn');
  var errorEl = document.getElementById('admin-lookup-error');
  var resultEl = document.getElementById('admin-lookup-result');
  if (!btn) return;

  function renderResult(data) {
    var isAdmin = !!window.sbmIsAdmin;
    var wallet = data.wallet || {};
    var profile = data.profile || {};
    var nickname = profile.nickname || '';

    var betsHtml = data.bets.length
      ? data.bets.map(function (b) {
          return '<div class="lookup-bet-row"><span>' + new Date(b.placedAt).toLocaleString('ko-KR') + ' · ' + (b.status || '') + '</span>' +
            '<span class="amount">' + sbmFmtNum(b.amount) + '원</span></div>';
        }).join('')
      : '<div class="lookup-bet-empty">배팅 내역이 없습니다.</div>';

    var actionsHtml = isAdmin
      ? '<div class="lookup-action-group">' +
          '<div class="lookup-action-title">잔액 조정</div>' +
          '<div class="lookup-action-row">' +
            '<input type="number" id="admin-adjust-amount" class="amount-input" placeholder="+/- 금액">' +
            '<input type="text" id="admin-adjust-reason" placeholder="사유">' +
            '<button class="lookup-btn-gold" id="admin-adjust-btn" type="button">적용</button>' +
          '</div>' +
        '</div>' +
        '<div class="lookup-action-group">' +
          '<div class="lookup-action-title">계정 정지</div>' +
          '<div class="lookup-action-row">' +
            (data.banned
              ? '<button class="lookup-btn-coral" id="admin-unban-btn" type="button">정지 해제</button>'
              : '<input type="text" id="admin-ban-reason" placeholder="정지 사유">' +
                '<button class="lookup-btn-coral" id="admin-ban-btn" type="button">계정 정지</button>') +
          '</div>' +
        '</div>'
      : '';

    resultEl.innerHTML =
      '<div class="lookup-card">' +
        '<div class="lookup-card-top">' +
          '<div class="lookup-avatar">' + sbmEscapeHtml(nickname ? nickname.charAt(0) : '?') + '</div>' +
          '<div class="lookup-identity">' +
            '<div class="lookup-nickname' + (nickname ? '' : ' muted') + '">' + sbmEscapeHtml(nickname || '닉네임 없음') + '</div>' +
            '<div class="lookup-uid">' + sbmEscapeHtml(data.uid) + '</div>' +
            (data.banned ? '<div class="lookup-uid" style="color:var(--coral);">정지 사유: ' + sbmEscapeHtml(data.banned.reason || '') + '</div>' : '') +
          '</div>' +
          '<span class="lookup-status-badge' + (data.banned ? ' banned' : '') + '">' + (data.banned ? '정지됨' : '정상') + '</span>' +
        '</div>' +
        '<div class="lookup-stats-row">' +
          '<div class="lookup-stat"><span class="label">보유 재화</span><span class="value">' + sbmFmtNum(wallet.balance || 0) + '원</span></div>' +
          '<div class="lookup-stat"><span class="label">가입일</span><span class="value">' + (wallet.accountCreatedAt ? new Date(wallet.accountCreatedAt).toLocaleDateString('ko-KR') : '-') + '</span></div>' +
        '</div>' +
        '<div class="lookup-section">' +
          '<div class="lookup-section-label">최근 배팅</div>' +
          '<div class="lookup-bets-list">' + betsHtml + '</div>' +
        '</div>' +
        (actionsHtml ? '<div class="lookup-actions">' + actionsHtml + '</div>' : '') +
      '</div>';

    var adjustBtn = document.getElementById('admin-adjust-btn');
    if (adjustBtn) {
      adjustBtn.addEventListener('click', function () {
        var amount = parseInt(document.getElementById('admin-adjust-amount').value, 10);
        var reason = document.getElementById('admin-adjust-reason').value.trim();
        if (!amount) { alert('조정 금액을 입력해 주세요.'); return; }
        if (!reason) { alert('사유를 입력해 주세요.'); return; }
        if (!confirm((amount > 0 ? '+' : '') + amount.toLocaleString('ko-KR') + '원을 조정할까요?\n사유: ' + reason)) return;
        adjustBtn.disabled = true;
        window.sbmFirebase.httpsCallable('adminAdjustBalance')({ uid: data.uid, delta: amount, reason: reason })
          .then(function () { btn.click(); })
          .catch(function (e) { alert(e.message); adjustBtn.disabled = false; });
      });
    }
    var banBtn = document.getElementById('admin-ban-btn');
    if (banBtn) {
      banBtn.addEventListener('click', function () {
        var reason = document.getElementById('admin-ban-reason').value.trim();
        if (!reason) { alert('정지 사유를 입력해 주세요.'); return; }
        if (!confirm('이 계정을 정지할까요?\n사유: ' + reason)) return;
        banBtn.disabled = true;
        window.sbmFirebase.httpsCallable('banAccount')({ uid: data.uid, reason: reason })
          .then(function () { btn.click(); })
          .catch(function (e) { alert(e.message); banBtn.disabled = false; });
      });
    }
    var unbanBtn = document.getElementById('admin-unban-btn');
    if (unbanBtn) {
      unbanBtn.addEventListener('click', function () {
        if (!confirm('이 계정의 정지를 해제할까요?')) return;
        unbanBtn.disabled = true;
        window.sbmFirebase.httpsCallable('unbanAccount')({ uid: data.uid })
          .then(function () { btn.click(); })
          .catch(function (e) { alert(e.message); unbanBtn.disabled = false; });
      });
    }
  }

  btn.addEventListener('click', function () {
    var query = input.value.trim();
    if (!query) return;
    errorEl.classList.remove('show');
    resultEl.innerHTML = '';
    btn.disabled = true;
    btn.textContent = '검색중...';
    window.sbmFirebase.httpsCallable('adminLookupUser')({ query: query })
      .then(function (res) {
        renderResult(res.data);
      })
      .catch(function (e) {
        errorEl.textContent = e.message || '검색 중 오류가 발생했습니다.';
        errorEl.classList.add('show');
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = '검색';
      });
  });
})();

(function () {
  var granularityWrap = document.getElementById('stats-granularity-chips');
  var metricWrap = document.getElementById('stats-metric-chips');
  if (!granularityWrap || !metricWrap) return;

  granularityWrap.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      granularityWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      sbmStatsChartState.granularity = chip.getAttribute('data-granularity');
      sbmRenderStatsChart();
    });
  });
  metricWrap.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      metricWrap.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      sbmStatsChartState.metric = chip.getAttribute('data-metric');
      sbmRenderStatsChart();
    });
  });
})();
