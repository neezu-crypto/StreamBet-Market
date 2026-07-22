var ATTENDANCE_SCHEDULE = [10000, 14000, 20000, 26000, 32000, 40000, 60000];

function sbmRenderAttendance(wallet) {
  var titleEl = document.getElementById('attendance-title');
  var streakEl = document.getElementById('attendance-streak');
  var btn = document.getElementById('attendance-claim-btn');
  if (!titleEl || !streakEl || !btn) return;

  if (!window.sbmRealUser) {
    titleEl.textContent = '출석 체크';
    btn.textContent = '로그인 후 출석 체크';
    btn.disabled = true;
    streakEl.querySelectorAll('.day').forEach(function (d) { d.classList.remove('done', 'today'); });
    return;
  }

  var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  var yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 86400000));
  var streak = wallet.attendanceStreak || 0;
  var claimedToday = wallet.lastAttendanceDate === today;
  var nextStreak = claimedToday ? streak : (wallet.lastAttendanceDate === yesterday ? streak + 1 : 1);
  var dayIndex = (nextStreak - 1) % 7;

  titleEl.textContent = '출석 체크 · ' + nextStreak + '일차';
  streakEl.querySelectorAll('.day').forEach(function (d, i) {
    d.classList.toggle('done', claimedToday ? i < dayIndex + 1 : i < dayIndex);
    d.classList.toggle('today', i === dayIndex);
  });
  if (claimedToday) {
    btn.textContent = '오늘 출석 완료';
    btn.disabled = true;
  } else {
    btn.textContent = '오늘 ' + ATTENDANCE_SCHEDULE[dayIndex].toLocaleString('ko-KR') + '원 받기';
    btn.disabled = false;
  }
}

(function () {
  if (!window.sbmFirebase) return;
  var fb = window.sbmFirebase;
  var walletAmountEl = document.getElementById('wallet-amount');
  var claimBtn = document.getElementById('attendance-claim-btn');

  document.addEventListener('sbm-auth-changed', function (e) {
    var user = e.detail.realUser;
    if (!user) {
      if (walletAmountEl) walletAmountEl.innerHTML = '0<small>원</small>';
      sbmRenderAttendance(null);
      return;
    }
    fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/wallets/' + user.uid), function (snap) {
      var wallet = snap.val() || { balance: 1000000 };
      if (walletAmountEl) walletAmountEl.innerHTML = Math.round(wallet.balance || 0).toLocaleString('ko-KR') + '<small>원</small>';
      sbmRenderAttendance(wallet);
    });
  });

  if (claimBtn) {
    claimBtn.addEventListener('click', function () {
      if (!window.sbmRealUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
      claimBtn.disabled = true;
      fb.httpsCallable('claimAttendance')({}).catch(function (e) {
        alert(e.message);
        claimBtn.disabled = false;
      });
    });
  }
})();
