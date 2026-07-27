var ATTENDANCE_SCHEDULE = [10000, 14000, 20000, 26000, 32000, 40000, 60000];

function sbmRenderAttendance(wallet) {
  var titleEl = document.getElementById('attendance-title');
  var streakEl = document.getElementById('attendance-streak');
  var btn = document.getElementById('attendance-claim-btn');
  if (!titleEl || !streakEl || !btn) return;

  if (!window.sbmUser) {
    titleEl.textContent = '출석 체크';
    btn.textContent = '로그인 후 출석 체크';
    btn.disabled = false;
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
  var unsubscribeWallet = null;

  document.addEventListener('sbm-auth-changed', function (e) {
    if (unsubscribeWallet) { unsubscribeWallet(); unsubscribeWallet = null; }
    var user = e.detail.user;
    if (!user) {
      if (walletAmountEl) walletAmountEl.innerHTML = '0<small>원</small>';
      sbmRenderAttendance(null);
      if (window.sbmRenderJackpotEligibility) window.sbmRenderJackpotEligibility(null);
      return;
    }
    unsubscribeWallet = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/wallets/' + user.uid), function (snap) {
      var wallet = snap.val() || { balance: 1000000 };
      window.sbmLastWallet = wallet; // js/checkin-modal.js가 오늘 보상 금액 계산에 재사용
      if (walletAmountEl) walletAmountEl.innerHTML = Math.round(wallet.balance || 0).toLocaleString('ko-KR') + '<small>원</small>';
      sbmRenderAttendance(wallet);
      if (window.sbmRenderJackpotEligibility) window.sbmRenderJackpotEligibility(wallet);
    });
  });

  // 출석 스케줄상 "오늘" 받을 기본 보상 금액(dayIndex 계산은 sbmRenderAttendance와 동일 로직) —
  // js/checkin-modal.js가 모달에 표시할 금액을 계산할 때도 재사용한다.
  window.sbmGetTodayAttendanceAmount = function (wallet) {
    if (!wallet) return ATTENDANCE_SCHEDULE[0];
    var today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    var yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 86400000));
    var streak = wallet.attendanceStreak || 0;
    var claimedToday = wallet.lastAttendanceDate === today;
    var nextStreak = claimedToday ? streak : (wallet.lastAttendanceDate === yesterday ? streak + 1 : 1);
    var dayIndex = (nextStreak - 1) % 7;
    return ATTENDANCE_SCHEDULE[dayIndex];
  };

  if (claimBtn) {
    claimBtn.addEventListener('click', function () {
      if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
      // 관리자는 "오늘 받기 / 광고보고 2배 받기" 선택 모달로(우선 관리자 시범 운영),
      // 그 외 계정은 기존처럼 바로 기본 보상을 받는다.
      if (window.sbmIsAdmin && window.sbmOpenCheckinModal) { window.sbmOpenCheckinModal(); return; }
      claimBtn.disabled = true;
      fb.httpsCallable('claimAttendance')({}).catch(function (e) {
        alert(e.message);
        claimBtn.disabled = false;
      });
    });
  }
})();
