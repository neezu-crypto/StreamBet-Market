// 로딩 화면이 끝난 뒤에도 실제 마켓 데이터가 안 왔으면(네트워크 문제 · 인증 실패 등)
// 빈 화면/스켈레톤만 계속 보이는 상태를 막기 위해 새로고침 안내 모달을 띄운다.
(function () {
  var TIMEOUT_MS = 12000;
  var backdrop = document.getElementById('reload-backdrop');
  var refreshBtn = document.getElementById('reload-refresh-btn');
  var dismissBtn = document.getElementById('reload-dismiss-btn');
  if (!backdrop) return;

  var timer = setTimeout(function () {
    if (!window.sbmMarketsLoaded) backdrop.classList.add('open');
  }, TIMEOUT_MS);

  document.addEventListener('sbm-markets-loaded', function () {
    clearTimeout(timer);
    backdrop.classList.remove('open');
  });

  refreshBtn.addEventListener('click', function () { window.location.reload(); });
  dismissBtn.addEventListener('click', function () { backdrop.classList.remove('open'); });
})();
