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
    started = true;
    var seen = false;
    try { seen = localStorage.getItem(SEEN_KEY) === '1'; } catch (e) {}
    if (seen) return;
    play(function () {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    });
  }

  // 부트 로딩이 끝나는 즉시 재생한다. 첫 방문 안내 모달은 같은 시점에 열리지만
  // 오프닝(stage z-index 2000) 아래 레이어에 남아, 오프닝이 끝난 뒤 자연스럽게
  // 안내를 이어서 확인할 수 있다.
  document.addEventListener('sbm-boot-done', function () {
    setTimeout(maybeShow, 50);
  });
}());
