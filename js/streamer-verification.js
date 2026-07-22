var sbmVerifiedCache = {}; // { pushKey: { nickname, soopId, uid, verifiedAt } }
var sbmVerifySubscribed = false;
var sbmVerifiedSubscribed = false;

function sbmVerifiedAvatarSrc(soopId) {
  if (!soopId) return ''; // soopId 필드가 없는 레거시 인증 레코드(주식시장 쪽에서 예전에 만들어진 것) 대비
  var demo = window.SBM_DEMO_AVATARS && window.SBM_DEMO_AVATARS[soopId];
  if (demo) return demo;
  var folder = soopId.slice(0, 2);
  return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
}

// 05번 — 공유 streamerVerifications 노드를 실시간 구독해 홍보 배너 · 관리 목록을 그린다.
function sbmSubscribeVerifiedStreamers() {
  if (sbmVerifiedSubscribed || !window.sbmFirebase) return;
  sbmVerifiedSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'streamerVerifications'), function (snap) {
    sbmVerifiedCache = snap.val() || {};
    sbmRenderVerifiedBanner();
    sbmRenderVerifiedStreamers();
  });
}

function sbmRenderVerifiedBanner() {
  var track = document.getElementById('verified-track');
  if (!track) return;
  var ctaBtn = document.getElementById('open-verify-modal');
  var items = Object.keys(sbmVerifiedCache).map(function (key) {
    var v = sbmVerifiedCache[key];
    var soopId = v.soopId || '';
    var avatarSrc = sbmVerifiedAvatarSrc(soopId);
    var avatarHtml = avatarSrc
      ? '<img class="verified-avatar" src="' + sbmEscapeHtml(avatarSrc) + '" alt="' + sbmEscapeHtml(v.nickname) + '">'
      : '<span class="verified-avatar verified-avatar-fallback">' + sbmEscapeHtml(v.nickname ? v.nickname.charAt(0) : '?') + '</span>';
    var href = soopId ? 'https://www.sooplive.com/station/' + encodeURIComponent(soopId) : '#';
    return '<a class="verified-item" data-soopid="' + sbmEscapeHtml(soopId) + '" href="' + href + '" target="_blank" rel="noopener noreferrer">' +
      '<div class="verified-avatar-ring">' + avatarHtml + '</div>' +
      '<span class="verified-name">' + sbmEscapeHtml(v.nickname) + '<small>✓ 인증</small></span></a>';
  }).join('');
  track.innerHTML = items;
  if (ctaBtn) track.appendChild(ctaBtn);
  if (window.sbmRefreshVerifiedTrack) window.sbmRefreshVerifiedTrack();
}

function sbmRenderVerifiedStreamers() {
  var list = document.getElementById('verified-streamers-list');
  if (!list) return;
  var keys = Object.keys(sbmVerifiedCache);
  if (!keys.length) {
    list.innerHTML = '<li class="audit-empty">인증된 스트리머가 없습니다.</li>';
    return;
  }
  var isAdmin = !!window.sbmIsAdmin;
  list.innerHTML = keys.map(function (key) {
    var v = sbmVerifiedCache[key];
    var soopIdField;
    if (v.soopId) {
      soopIdField = '<span>SOOP 아이디: ' + sbmEscapeHtml(v.soopId) + '</span>';
    } else if (isAdmin) {
      soopIdField = '<span class="verify-soopid-missing">SOOP 아이디 미기재' +
        '<input type="text" class="verify-soopid-input" data-record-id="' + key + '" placeholder="SOOP 아이디 입력">' +
        '<button class="verify-req-approve verify-soopid-save-btn" data-record-id="' + key + '" type="button">저장</button></span>';
    } else {
      soopIdField = '<span>SOOP 아이디 미기재</span>';
    }
    var revokeBtn = isAdmin
      ? '<button class="verify-req-reject" data-soopid="' + sbmEscapeHtml(v.soopId || '') + '" type="button">인증 해제</button>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(v.nickname) + '</b>' + soopIdField + '</div>' +
      '<div class="verify-req-actions">' + revokeBtn + '</div></li>';
  }).join('');

  list.querySelectorAll('.verify-soopid-save-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var recordId = btn.getAttribute('data-record-id');
      var input = list.querySelector('.verify-soopid-input[data-record-id="' + recordId + '"]');
      var soopId = input.value.trim();
      if (!soopId) { alert('SOOP 아이디를 입력해 주세요.'); return; }
      btn.disabled = true;
      input.disabled = true;
      window.sbmFirebase.httpsCallable('setVerifiedSoopId')({ recordId: recordId, soopId: soopId })
        .catch(function (e) {
          alert(e.message);
          btn.disabled = false;
          input.disabled = false;
        });
    });
  });

  list.querySelectorAll('.verify-req-reject').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!btn.getAttribute('data-soopid')) {
        alert('SOOP 아이디가 없어서 인증 해제할 수 없습니다. 먼저 SOOP 아이디를 입력해 주세요.');
        return;
      }
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('revokeVerification')({ soopId: btn.getAttribute('data-soopid') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

// 05번 — 배팅시장 자체 신청함 (verifyRequests). 결과는 저장하지 않고 위 공유 노드로 승인 시 이관된다.
var sbmVerifyRequestsCache = {};

function sbmRenderVerifyRequestsList() {
  var list = document.getElementById('verify-requests-list');
  if (!list) return;
  var fb = window.sbmFirebase;
  var isAdmin = !!window.sbmIsAdmin;
  var reqs = Object.keys(sbmVerifyRequestsCache).map(function (id) { return Object.assign({ id: id }, sbmVerifyRequestsCache[id]); })
    .sort(function (a, b) { return b.submittedAt - a.submittedAt; });
  if (!reqs.length) {
    list.innerHTML = '<li class="audit-empty">대기 중인 인증 신청이 없습니다.</li>';
    return;
  }
  list.innerHTML = reqs.map(function (r) {
    var actions = isAdmin
      ? '<button class="verify-req-approve" data-request-id="' + r.id + '" type="button">승인</button>' +
        '<button class="verify-req-reject" data-request-id="' + r.id + '" type="button">반려</button>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(r.nickname) + '</b><span>SOOP 아이디: ' + sbmEscapeHtml(r.soopId) + ' · ' + new Date(r.submittedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + actions + '</div></li>';
  }).join('');

  list.querySelectorAll('.verify-req-approve').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fb.httpsCallable('approveVerification')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
  list.querySelectorAll('.verify-req-reject').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      fb.httpsCallable('rejectVerification')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

function sbmRenderVerifyRequests() {
  var list = document.getElementById('verify-requests-list');
  if (!list || sbmVerifySubscribed || !window.sbmFirebase) return;
  sbmVerifySubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/verifyRequests'), function (snap) {
    sbmVerifyRequestsCache = snap.val() || {};
    sbmRenderVerifyRequestsList();
  });
}

document.addEventListener('sbm-auth-changed', function () {
  sbmRenderVerifyRequestsList();
  sbmRenderVerifiedStreamers();
});

(function () {
  var openBtn = document.getElementById('open-verify-modal');
  var backdrop = document.getElementById('verify-backdrop');
  var closeBtn = document.getElementById('verify-modal-close');
  var nicknameInput = document.getElementById('verify-nickname');
  var soopIdInput = document.getElementById('verify-soopid');
  var previewImg = document.getElementById('verify-preview-img');
  var previewPlaceholder = document.getElementById('verify-preview-placeholder');
  var submitBtn = document.getElementById('verify-submit-btn');
  var statusEl = document.getElementById('verify-status');
  if (!backdrop) return;

  function resetForm() {
    nicknameInput.value = '';
    soopIdInput.value = '';
    nicknameInput.disabled = false;
    soopIdInput.disabled = false;
    previewImg.style.display = 'none';
    previewImg.src = '';
    previewPlaceholder.style.display = '';
    submitBtn.disabled = false;
    submitBtn.textContent = '신청하기';
    statusEl.classList.remove('show');
    statusEl.textContent = '';
  }

  function openModal() {
    resetForm();
    backdrop.classList.add('open');
    nicknameInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    if (e.target.closest('#open-verify-modal')) openModal();
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  soopIdInput.addEventListener('input', function () {
    var id = soopIdInput.value.trim();
    if (id.length < 2) {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
      return;
    }
    previewImg.onload = function () { previewImg.style.display = 'block'; previewPlaceholder.style.display = 'none'; };
    previewImg.onerror = function () { previewImg.style.display = 'none'; previewPlaceholder.style.display = ''; };
    previewImg.src = sbmVerifiedAvatarSrc(id);
  });

  submitBtn.addEventListener('click', function () {
    if (!nicknameInput.value.trim() || !soopIdInput.value.trim()) {
      statusEl.textContent = '닉네임과 SOOP 아이디를 모두 입력해 주세요.';
      statusEl.style.color = 'var(--coral)';
      statusEl.classList.add('show');
      return;
    }
    if (nicknameInput.value.trim().length > 20 || /[<>\x00-\x1F\x7F]/.test(nicknameInput.value.trim())) {
      statusEl.textContent = '닉네임은 20자 이하, 사용할 수 없는 문자 없이 입력해 주세요.';
      statusEl.style.color = 'var(--coral)';
      statusEl.classList.add('show');
      return;
    }
    if (!/^[a-z0-9]{2,20}$/.test(soopIdInput.value.trim())) {
      statusEl.textContent = 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.';
      statusEl.style.color = 'var(--coral)';
      statusEl.classList.add('show');
      return;
    }
    nicknameInput.disabled = true;
    soopIdInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '신청 처리중...';

    window.sbmFirebase.httpsCallable('submitVerificationRequest')({
      nickname: nicknameInput.value.trim(),
      soopId: soopIdInput.value.trim(),
    }).then(function () {
      submitBtn.textContent = '신청 완료';
      statusEl.style.color = 'var(--mint)';
      statusEl.textContent = '신청이 접수됐습니다. 관리자 검수 후 승인되면 홍보 배너에 노출됩니다.';
      statusEl.classList.add('show');
    }).catch(function (err) {
      nicknameInput.disabled = false;
      soopIdInput.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = '신청하기';
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = err.message || '신청 처리 중 오류가 발생했습니다.';
      statusEl.classList.add('show');
    });
  });
})();

(function () {
  var viewport = document.getElementById('verified-viewport');
  var track = document.getElementById('verified-track');
  if (!viewport || !track) return;

  function setup() {
    track.classList.remove('auto-scroll');
    track.querySelectorAll('[data-clone]').forEach(function (el) { el.remove(); });

    var overflowing = track.scrollWidth > viewport.clientWidth + 4;
    if (!overflowing) return;

    var originalWidth = track.scrollWidth;
    var originalChildren = Array.prototype.slice.call(track.children);
    originalChildren.forEach(function (child) {
      var clone = child.cloneNode(true);
      clone.setAttribute('data-clone', '');
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('tabindex', '-1');
      track.appendChild(clone);
    });

    var pxPerSecond = 40;
    var duration = Math.max(originalWidth / pxPerSecond, 8);
    track.style.setProperty('--verified-duration', duration + 's');
    track.classList.add('auto-scroll');
  }

  setup();
  window.addEventListener('resize', function () {
    clearTimeout(window.__verifiedResizeTimer);
    window.__verifiedResizeTimer = setTimeout(setup, 200);
  });
  window.sbmRefreshVerifiedTrack = setup;
  window.sbmVerifiedTrackEl = track;

  sbmSubscribeVerifiedStreamers();
})();
