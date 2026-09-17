/* 오목지면시그 시그니처 오프닝 — 스트리머 게임시리즈 공용 브랜드 모먼트. */
(function () {
  var LAST_SHOWN_KEY = 'ojmSigSplashLastShown_bettingMarket_v1';
  var SHOW_INTERVAL_MS = 24 * 60 * 60 * 1000;
  var DURATION_MS = 3400;
  var started = false;

  function play(onDone) {
    var stage = document.getElementById('sig-opening-stage');
    if (!stage) { if (typeof onDone === 'function') onDone(); return; }
    var series = stage.querySelector('.sig-series');
    var seriesTag = stage.querySelector('.sig-series-tag');
    var reelTrack = stage.querySelector('.sig-reel-track');
    var underline = stage.querySelector('.sig-series-under');
    var titleFrame = stage.querySelector('.sig-title-frame');
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rafId = null;
    var now = function () {
      return (window.performance && typeof window.performance.now === 'function')
        ? window.performance.now() : Date.now();
    };
    var requestFrame = window.requestAnimationFrame || function (callback) {
      return window.setTimeout(function () { callback(now()); }, 16);
    };
    var cancelFrame = window.cancelAnimationFrame || window.clearTimeout;
    var startedAt = now();

    // CSS animation 대신 단조 시계로 모든 단계를 직접 계산해 주사율에 따른
    // 샘플링 차이가 오프닝 속도 차이로 이어지지 않게 한다.
    function clamp01(value) { return Math.max(0, Math.min(1, value)); }
    function smoothStep(value) {
      value = clamp01(value);
      return value * value * (3 - 2 * value);
    }
    function easeOutCubic(value) {
      value = clamp01(value);
      return 1 - Math.pow(1 - value, 3);
    }
    function progress(elapsed, start, duration) {
      if (elapsed < start) return 0;
      if (reduceMotion) return 1;
      return clamp01((elapsed - start) / duration);
    }
    function applyTimeline(timestamp) {
      var elapsed = Math.max(0, timestamp - startedAt);
      var seriesIn = progress(elapsed, 0, 700);
      var seriesOut = progress(elapsed, 2300, 500);
      series.style.opacity = String(elapsed < 2300 ? seriesIn : 1 - seriesOut);
      series.style.transform = 'translateY(' + (elapsed < 2300
        ? 18 * (1 - easeOutCubic(seriesIn)) : -14 * seriesOut) + 'px)';

      var tagProgress = progress(elapsed, 0, 450);
      seriesTag.style.opacity = String(tagProgress);
      seriesTag.style.transform = 'translateY(' + (18 * (1 - easeOutCubic(tagProgress))) + 'px)';

      var reelProgress = progress(elapsed, 500, 1000);
      var reelStep = Math.min(5, Math.floor(reelProgress * 5 + 0.000001));
      reelTrack.style.transform = 'translateY(' + (-44 * reelStep) + 'px)';

      var underlineProgress = progress(elapsed, 1500, 500);
      underline.style.width = (180 * smoothStep(underlineProgress)) + 'px';

      var titleProgress = progress(elapsed, 2600, 600);
      titleFrame.style.opacity = String(titleProgress);
      titleFrame.style.transform = 'translateY(' + (18 * (1 - easeOutCubic(titleProgress))) + 'px)';
      if (!finished) rafId = requestFrame(applyTimeline);
    }
    function resetInlineStyles() {
      [series, seriesTag, reelTrack, underline, titleFrame].forEach(function (element) {
        element.removeAttribute('style');
      });
    }

    stage.classList.remove('is-leaving');
    stage.classList.add('is-js-timeline', 'is-playing');
    var finished = false;
    rafId = requestFrame(applyTimeline);
    var timer = setTimeout(finish, DURATION_MS);
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (rafId !== null) cancelFrame(rafId);
      stage.removeEventListener('click', finish);
      stage.removeEventListener('keydown', onKeydown);
      stage.classList.add('is-leaving');
      setTimeout(function () {
        stage.classList.remove('is-js-timeline', 'is-playing', 'is-leaving');
        resetInlineStyles();
        if (typeof onDone === 'function') onDone();
      }, reduceMotion ? 0 : 400);
    }
    function onKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); }
    }
    stage.addEventListener('click', finish);
    stage.addEventListener('keydown', onKeydown);
  }

  function maybeShow() {
    if (started) return;
    started = true;
    var now = Date.now();
    var lastShownAt = 0;
    try { lastShownAt = Number(localStorage.getItem(LAST_SHOWN_KEY)) || 0; } catch (e) {}
    if (lastShownAt > 0 && now >= lastShownAt && now - lastShownAt < SHOW_INTERVAL_MS) return;
    play(function () {
      try { localStorage.setItem(LAST_SHOWN_KEY, String(Date.now())); } catch (e) {}
    });
  }

  // 오프닝을 즉시 시작해 아래 페이지·데이터 로딩은 오프닝 하위 레이어에서
  // 동시에 진행한다.
  maybeShow();
}());
