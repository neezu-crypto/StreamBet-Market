(function () {
  var overlay = document.getElementById('boot-overlay');
  var bar = document.getElementById('boot-progress-bar');
  var steps = overlay ? Array.prototype.slice.call(overlay.querySelectorAll('.boot-steps li')) : [];
  if (!overlay || !bar || !steps.length) return;

  // 데이터 종류별 캐시 유효 시간 — 자주 안 바뀌는 건 길게, 잔액/배팅 내역처럼 자주 바뀌는 건 짧게
  var CACHE_TTL = {
    stocks: 5 * 60 * 1000,
    markets: 30 * 1000,
    wallet: 15 * 1000,
    bets: 15 * 1000,
    verified: 5 * 60 * 1000
  };
  var CACHE_PREFIX = 'sbm_cache_';

  function isFresh(step) {
    var ts = localStorage.getItem(CACHE_PREFIX + step);
    if (!ts) return false;
    return (Date.now() - parseInt(ts, 10)) < (CACHE_TTL[step] || 0);
  }
  function markFetched(step) {
    try { localStorage.setItem(CACHE_PREFIX + step, String(Date.now())); } catch (e) {}
  }

  document.body.style.overflow = 'hidden';

  var i = 0;
  function nextStep() {
    if (i > 0) steps[i - 1].classList.replace('loading', 'done');
    if (i >= steps.length) {
      bar.style.width = '100%';
      setTimeout(function () {
        overlay.classList.add('done');
        document.body.style.overflow = '';
        document.dispatchEvent(new CustomEvent('sbm-boot-done'));
      }, 300);
      return;
    }
    var el = steps[i];
    var stepKey = el.getAttribute('data-step');
    bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%';
    i += 1;

    if (isFresh(stepKey)) {
      // 최근에 이미 받아온 데이터 — 다시 다운로드하지 않고 즉시 통과
      el.textContent += ' (캐시됨)';
      el.classList.add('done');
      setTimeout(nextStep, 90);
      return;
    }

    el.classList.add('loading');
    setTimeout(function () {
      markFetched(stepKey);
      nextStep();
    }, 420 + Math.random() * 260);
  }
  nextStep();
})();
