// 14번 — 잭팟: 그날 배팅에 1회 이상 참여한 계정이 하루 한 번, 1/50 확률로 잭팟 적립금
// 전액에 도전한다. 당첨 여부와 무관하게 하루 시도 기회는 소모된다.
function sbmRenderJackpotEligibility(wallet) {
  var btn = document.getElementById('jackpot-claim-btn');
  if (!btn) return;

  if (!window.sbmUser) {
    btn.textContent = '로그인 후 잭팟 확인하기';
    btn.disabled = false;
    return;
  }

  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  var betToday = wallet && wallet.dailyBetDate === today;
  var drawnToday = wallet && wallet.lastJackpotDrawDate === today;

  if (drawnToday) {
    btn.textContent = '오늘 확인 완료';
    btn.disabled = true;
  } else if (!betToday) {
    btn.textContent = '오늘 배팅 후 확인 가능';
    btn.disabled = true;
  } else {
    btn.textContent = '잭팟 확인하기';
    btn.disabled = false;
  }
}

(function () {
  var amountEl = document.getElementById('jackpot-amount');
  var btn = document.getElementById('jackpot-claim-btn');
  var statusEl = document.getElementById('jackpot-status');
  if (!btn || !window.sbmFirebase) return;
  var fb = window.sbmFirebase;

  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/jackpot/balance'), function (snap) {
    if (amountEl) amountEl.innerHTML = Math.round(snap.val() || 0).toLocaleString('ko-KR') + '<small>원</small>';
  });

  btn.addEventListener('click', function () {
    if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    btn.disabled = true;
    statusEl.classList.remove('show');
    fb.httpsCallable('claimJackpotDraw')({})
      .then(function (res) {
        var d = res.data;
        if (d.won && d.amount > 0) {
          statusEl.style.color = 'var(--gold)';
          statusEl.textContent = '🎉 당첨! ' + Math.round(d.amount).toLocaleString('ko-KR') + '원을 획득했습니다.';
        } else if (d.won) {
          statusEl.style.color = 'var(--muted)';
          statusEl.textContent = '아쉽게도 당첨 시점에 잭팟이 이미 소진된 상태였어요.';
        } else {
          statusEl.style.color = 'var(--muted)';
          statusEl.textContent = '꽝! 내일 다시 도전해 보세요.';
        }
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '처리 중 오류가 발생했습니다.';
        statusEl.classList.add('show');
        btn.disabled = false;
      });
  });
})();

// 지난 잭팟 당첨내역 모달 — 닉네임·아바타는 프로필 노드와 uid로 조인해서 표시한다.
(function () {
  var openBtn = document.getElementById('open-jackpot-history');
  var backdrop = document.getElementById('jackpot-history-backdrop');
  var closeBtn = document.getElementById('jackpot-history-close');
  var listEl = document.getElementById('jackpot-history-list');
  if (!openBtn || !backdrop) return;

  function renderList(wins, profiles) {
    if (!wins.length) {
      listEl.innerHTML = '<li class="settlement-empty">아직 잭팟 당첨 내역이 없습니다.</li>';
      return;
    }
    listEl.innerHTML = wins.map(function (w) {
      var profile = profiles[w.uid] || {};
      var nickname = profile.nickname || '유저';
      var avatarHtml = profile.avatarUrl
        ? '<img class="jackpot-history-avatar" src="' + sbmEscapeHtml(profile.avatarUrl) + '" alt="">'
        : '<span class="jackpot-history-avatar-fallback">' + sbmEscapeHtml(nickname.charAt(0)) + '</span>';
      return '<li class="jackpot-history-item">' + avatarHtml +
        '<div class="jackpot-history-info"><span class="jackpot-history-name">' + sbmEscapeHtml(nickname) + '</span>' +
        '<span class="jackpot-history-time">' + new Date(w.at).toLocaleString('ko-KR') + '</span></div>' +
        '<span class="jackpot-history-amount">' + Math.round(w.amount).toLocaleString('ko-KR') + '원</span></li>';
    }).join('');
  }

  function openModal() {
    backdrop.classList.add('open');
    listEl.innerHTML = '<li class="settlement-empty">불러오는 중...</li>';
    if (!window.sbmFirebase) return;
    var fb = window.sbmFirebase;
    Promise.all([
      fb.get(fb.ref(window.sbmDb, 'bettingMarket/jackpotWins')),
      fb.get(fb.ref(window.sbmDb, 'bettingMarket/profiles')),
    ]).then(function (results) {
      var winsVal = results[0].val() || {};
      var profiles = results[1].val() || {};
      var wins = Object.values(winsVal).sort(function (a, b) { return b.at - a.at; }).slice(0, 50);
      renderList(wins, profiles);
    }).catch(function (e) {
      listEl.innerHTML = '<li class="settlement-empty">오류: ' + sbmEscapeHtml(e.message) + '</li>';
    });
  }
  function closeModal() { backdrop.classList.remove('open'); }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
})();
