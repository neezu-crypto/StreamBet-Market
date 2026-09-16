/* 오목지면시그 시그니처 오프닝 — 스트리머 게임시리즈 공용 브랜드 모먼트. */
(function () {
  var SEEN_KEY = 'ojmSigSplashSeen_v1';
  var DURATION_MS = 3400;
  var started = false;

  function play(onDone) {
    var stage = document.getElementById('sig-opening-stage');
    if (!stage) { onDone(); return; }
    stage.classList.add('is-playing');
    var finished = false;
    var timer = setTimeout(finish, DURATION_MS);
    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stage.removeEventListener('click', finish);
      stage.removeEventListener('keydown', onKeydown);
      stage.classList.add('is-leaving');
      setTimeout(function () {
        stage.classList.remove('is-playing', 'is-leaving');
        onDone();
      }, 400);
    }
    function onKeydown(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); finish(); }
    }
    stage.addEventListener('click', finish);
    stage.addEventListener('keydown', onKeydown);
  }

  function maybeShow() {
    if (started) return;
    var intro = document.getElementById('intro-backdrop');
    // sbm-boot-done 이벤트의 리스너 실행 순서에 따라 intro-modal.js가
    // open 클래스를 붙이기 전일 수 있으므로, 실제 시작 직전에 한 번 더
    // 확인한다. 안내 모달이 열려 있으면 닫힌 뒤 다음 시도에서 진행한다.
    if (intro && intro.classList.contains('open')) {
      setTimeout(maybeShow, 100);
      return;
    }
    started = true;
    var seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
    if (seen) return;
    play(function () {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    });
  }

  // 부트 로딩이 끝난 뒤, 첫 방문 안내 모달이 닫힌 다음에 재생한다. 안내 모달을
  // 오프닝이 가려버리지 않도록 open 상태를 짧게 감시한다.
  document.addEventListener('sbm-boot-done', function () {
    var intro = document.getElementById('intro-backdrop');
    if (!intro || !intro.classList.contains('open')) { setTimeout(maybeShow, 250); return; }
    var wait = setInterval(function () {
      if (!intro.classList.contains('open')) {
        clearInterval(wait);
        setTimeout(maybeShow, 250);
      }
    }, 100);
  });
}());
