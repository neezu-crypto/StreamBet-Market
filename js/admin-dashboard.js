// 관리 탭 — 대시보드 요약 / 이상 거래 모니터링 / 환전 내역(관리자·인증 스트리머 공통),
// 유저 검색 · 수동 잔액 조정 · 계정 정지(관리자 전용).
var sbmBannedAccountsCache = {};
var sbmBannedListSubscribed = false;

function sbmRenderAdminDashboard() {
  var circEl = document.getElementById('stat-circulation');
  if (!circEl || !window.sbmFirebase) return;
  window.sbmFirebase.httpsCallable('getAdminDashboardStats')({}).then(function (res) {
    var d = res.data;
    circEl.textContent = sbmFmtNum(d.totalCirculation) + '원';
    document.getElementById('stat-new-wallets').textContent = d.newWalletsToday + '개';
    document.getElementById('stat-active-markets').textContent = d.activeMarkets + '개';
    document.getElementById('stat-bet-today').textContent = sbmFmtNum(d.totalBetAmountToday) + '원 · ' + d.totalBetCountToday + '건';
  }).catch(function (e) { circEl.textContent = '오류: ' + e.message; });
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

function sbmRenderBannedAccounts() {
  var listEl = document.getElementById('banned-accounts-list');
  if (!listEl) return;
  var isAdmin = !!window.sbmIsAdmin;
  var keys = Object.keys(sbmBannedAccountsCache);
  if (!keys.length) {
    listEl.innerHTML = '<li class="audit-empty">정지된 계정이 없습니다.</li>';
    return;
  }
  listEl.innerHTML = keys.map(function (uid) {
    var b = sbmBannedAccountsCache[uid];
    var unbanBtn = isAdmin ? '<button class="verify-req-reject admin-unban-btn" data-uid="' + uid + '" type="button">정지 해제</button>' : '';
    return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(uid) + '</b>' +
      '<span>' + sbmEscapeHtml(b.reason || '') + ' · ' + new Date(b.bannedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + unbanBtn + '</div></li>';
  }).join('');

  listEl.querySelectorAll('.admin-unban-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('unbanAccount')({ uid: btn.getAttribute('data-uid') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

function sbmSubscribeBannedAccounts() {
  if (sbmBannedListSubscribed || !window.sbmFirebase) return;
  sbmBannedListSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/bannedAccounts'), function (snap) {
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
    var banHtml = data.banned
      ? '<span class="admin-ban-tag">정지됨 · ' + sbmEscapeHtml(data.banned.reason || '') + '</span>'
      : '';
    var betsHtml = data.bets.length
      ? data.bets.map(function (b) {
          return '<div>' + new Date(b.placedAt).toLocaleString('ko-KR') + ' · ' + sbmFmtNum(b.amount) + '원 · ' + (b.status || '') + '</div>';
        }).join('')
      : '<div>배팅 내역이 없습니다.</div>';

    var actionsHtml = isAdmin
      ? '<div class="admin-lookup-adjust-row">' +
          '<input type="number" id="admin-adjust-amount" placeholder="조정 금액(+/-)">' +
          '<input type="text" id="admin-adjust-reason" placeholder="사유">' +
          '<button class="verify-req-approve" id="admin-adjust-btn" type="button">잔액 조정</button>' +
        '</div>' +
        '<div class="admin-lookup-adjust-row">' +
          '<input type="text" id="admin-ban-reason" placeholder="정지 사유">' +
          (data.banned
            ? '<button class="verify-req-reject" id="admin-unban-btn" type="button">정지 해제</button>'
            : '<button class="verify-req-reject" id="admin-ban-btn" type="button">계정 정지</button>') +
        '</div>'
      : '';

    resultEl.innerHTML =
      '<div class="admin-lookup-result-head"><b>' + sbmEscapeHtml(profile.nickname || '(닉네임 없음)') + '</b>' +
      '<span>uid: ' + sbmEscapeHtml(data.uid) + '</span>' + banHtml + '</div>' +
      '<div>보유 재화 <b>' + sbmFmtNum(wallet.balance || 0) + '원</b>' +
      (wallet.accountCreatedAt ? ' · 가입 ' + new Date(wallet.accountCreatedAt).toLocaleDateString('ko-KR') : '') + '</div>' +
      '<div class="admin-lookup-bets">' + betsHtml + '</div>' +
      actionsHtml;

    var adjustBtn = document.getElementById('admin-adjust-btn');
    if (adjustBtn) {
      adjustBtn.addEventListener('click', function () {
        var amount = parseInt(document.getElementById('admin-adjust-amount').value, 10);
        var reason = document.getElementById('admin-adjust-reason').value.trim();
        if (!amount) { alert('조정 금액을 입력해 주세요.'); return; }
        if (!reason) { alert('사유를 입력해 주세요.'); return; }
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
        banBtn.disabled = true;
        window.sbmFirebase.httpsCallable('banAccount')({ uid: data.uid, reason: reason })
          .then(function () { btn.click(); })
          .catch(function (e) { alert(e.message); banBtn.disabled = false; });
      });
    }
    var unbanBtn = document.getElementById('admin-unban-btn');
    if (unbanBtn) {
      unbanBtn.addEventListener('click', function () {
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
