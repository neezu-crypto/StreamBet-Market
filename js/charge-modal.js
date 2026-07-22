// 자산 충전 — 개발자 라이브 방송 후원 + 룰렛 결과에 따른 지급 신청 접수(관리자 전용 승인).
var sbmChargeRequestsCache = {};
var sbmChargeSubscribed = false;

function sbmRenderChargeRequests() {
  var list = document.getElementById('charge-requests-list');
  if (!list || sbmChargeSubscribed || !window.sbmFirebase) return;
  sbmChargeSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/chargeRequests'), function (snap) {
    sbmChargeRequestsCache = snap.val() || {};
    sbmRenderChargeRequestsList();
  });
}

function sbmRenderChargeRequestsList() {
  var list = document.getElementById('charge-requests-list');
  if (!list) return;
  var isAdmin = !!window.sbmIsAdmin;
  var reqs = Object.keys(sbmChargeRequestsCache).map(function (id) { return Object.assign({ id: id }, sbmChargeRequestsCache[id]); })
    .sort(function (a, b) { return b.requestedAt - a.requestedAt; });
  if (!reqs.length) {
    list.innerHTML = '<li class="audit-empty">대기 중인 충전 신청이 없습니다.</li>';
    return;
  }
  list.innerHTML = reqs.map(function (r) {
    var actions = isAdmin
      ? '<input type="text" inputmode="numeric" class="verify-soopid-input charge-amount-input" data-request-id="' + r.id + '" placeholder="지급액">' +
        '<button class="verify-req-approve charge-grant-btn" data-request-id="' + r.id + '" type="button">지급</button>' +
        '<button class="verify-req-reject charge-dismiss-btn" data-request-id="' + r.id + '" type="button">무시</button>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(r.nickname) + '</b><span>' + new Date(r.requestedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + actions + '</div></li>';
  }).join('');

  list.querySelectorAll('.charge-grant-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var requestId = btn.getAttribute('data-request-id');
      var input = list.querySelector('.charge-amount-input[data-request-id="' + requestId + '"]');
      var amount = parseInt((input.value || '').replace(/[^0-9]/g, ''), 10);
      if (!amount || amount <= 0) { alert('지급액을 입력해 주세요.'); return; }
      btn.disabled = true;
      input.disabled = true;
      window.sbmFirebase.httpsCallable('grantChargeRequest')({ requestId: requestId, amount: amount })
        .catch(function (e) { alert(e.message); btn.disabled = false; input.disabled = false; });
    });
  });
  list.querySelectorAll('.charge-dismiss-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('dismissChargeRequest')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

document.addEventListener('sbm-auth-changed', sbmRenderChargeRequestsList);

(function () {
  var openBtn = document.getElementById('open-charge-modal');
  var backdrop = document.getElementById('charge-backdrop');
  var closeBtn = document.getElementById('charge-modal-close');
  var nicknameInput = document.getElementById('charge-nickname');
  var errorEl = document.getElementById('charge-error');
  var submitBtn = document.getElementById('charge-submit-btn');
  var statusEl = document.getElementById('charge-status');
  if (!openBtn || !backdrop) return;

  function openModal() {
    if (!window.sbmRealUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    nicknameInput.value = '';
    nicknameInput.disabled = false;
    errorEl.classList.remove('show');
    statusEl.classList.remove('show');
    submitBtn.disabled = false;
    submitBtn.textContent = '신청하기';
    backdrop.classList.add('open');
    nicknameInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  submitBtn.addEventListener('click', function () {
    if (!window.sbmRealUser) {
      errorEl.textContent = '신청하려면 로그인이 필요합니다 (Ctrl+Enter).';
      errorEl.classList.add('show');
      return;
    }
    var nickname = nicknameInput.value.trim();
    if (!nickname) {
      errorEl.textContent = '닉네임을 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    if (nickname.length > 20 || /[<>\x00-\x1F\x7F]/.test(nickname)) {
      errorEl.textContent = '닉네임은 20자 이하, 사용할 수 없는 문자 없이 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    nicknameInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '신청 처리중...';

    window.sbmFirebase.httpsCallable('submitChargeRequest')({ nickname: nickname })
      .then(function () {
        submitBtn.textContent = '신청 완료';
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = '신청이 접수됐습니다. 방송에서 후원·룰렛 결과 확인 후 관리자가 지급합니다.';
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        nicknameInput.disabled = false;
        submitBtn.disabled = false;
        submitBtn.textContent = '신청하기';
        errorEl.textContent = err.message || '신청 처리 중 오류가 발생했습니다.';
        errorEl.classList.add('show');
      });
  });
})();
