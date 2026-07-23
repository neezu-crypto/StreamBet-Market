// 계정 정지 안내 배너 — 정지된 유저는 버튼을 누를 때마다 에러만 보는 대신,
// 접속하자마자 상단에 정지 사실과 사유를 고정으로 안내받는다.
(function () {
  var banner = document.getElementById('banned-banner');
  var reasonEl = document.getElementById('banned-banner-reason');
  if (!banner) return;
  var unsubscribe = null;

  document.addEventListener('sbm-auth-changed', function (e) {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    var user = e.detail.user;
    if (!user || !window.sbmFirebase) {
      banner.style.display = 'none';
      return;
    }
    var fb = window.sbmFirebase;
    var ref = fb.ref(window.sbmDb, 'bettingMarket/bannedAccounts/' + user.uid);
    unsubscribe = fb.onValue(ref, function (snap) {
      if (snap.exists()) {
        var ban = snap.val();
        reasonEl.textContent = ban.reason ? ' (사유: ' + ban.reason + ')' : '';
        banner.style.display = '';
      } else {
        banner.style.display = 'none';
      }
    });
  });
})();
