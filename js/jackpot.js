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
