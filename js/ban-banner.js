// 계정 정지 안내 배너 — 정지된 유저는 버튼을 누를 때마다 에러만 보는 대신,
// 접속하자마자 상단에 정지 사실과 사유를 고정으로 안내받는다.
// 20번 2단계 — soop-stock-market과 공유하는 bannedAccounts/{uid} 원장을 본다.
// 정지는 기본이 게임별이라, all이 없으면 games.bettingMarket이 있을 때만 보여준다
// (주식시장에서만 정지된 계정은 이 배너를 못 봄 - 여기선 안 막혔으니 맞는 동작).
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
    var ref = fb.ref(window.sbmDb, 'bannedAccounts/' + user.uid);
    unsubscribe = fb.onValue(ref, function (snap) {
      var ban = snap.val();
      var scoped = ban && (ban.all ? { reason: ban.allReason } : (ban.games && ban.games.bettingMarket));
      if (scoped) {
        reasonEl.textContent = scoped.reason ? ' (사유: ' + scoped.reason + ')' : '';
        banner.style.display = '';
      } else {
        banner.style.display = 'none';
      }
    });
  });
})();
