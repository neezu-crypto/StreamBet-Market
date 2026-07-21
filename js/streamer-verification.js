var sbmVerifiedCache = {}; // { pushKey: { nickname, soopId, uid, verifiedAt } }
var sbmVerifySubscribed = false;
var sbmVerifiedSubscribed = false;

function sbmVerifiedAvatarSrc(soopId) {
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
    return '<a class="verified-item" data-soopid="' + v.soopId + '" href="https://www.sooplive.com/station/' + v.soopId + '" target="_blank" rel="noopener noreferrer">' +
      '<div class="verified-avatar-ring"><img class="verified-avatar" src="' + sbmVerifiedAvatarSrc(v.soopId) + '" alt="' + v.nickname + '"></div>' +
      '<span class="verified-name">' + v.nickname + '<small>✓ 인증</small></span></a>';
  }).join('');
  track.innerHTML = items;
  if (ctaBtn) track.appendChild(ctaBtn);
  if (window.sbmRefreshVerifiedTrack) window.sbmRefreshVerifiedTrack();
}

function sbmRenderVerifiedStreamers() {
  var list = document.getElementById('verified-streamers-list');
  if (!list) return;
  var entries = Object.keys(sbmVerifiedCache).map(function (key) { return sbmVerifiedCache[key]; });
  if (!entries.length) {
    list.innerHTML = '<li class="audit-empty">인증된 스트리머가 없습니다.</li>';
    return;
  }
  list.innerHTML = entries.map(function (v) {
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + v.nickname + '</b><span>SOOP 아이디: ' + v.soopId + '</span></div>' +
      '<div class="verify-req-actions">' +
      '<button class="verify-req-reject" data-soopid="' + v.soopId + '" type="button">인증 해제</button>' +
      '</div></li>';
  }).join('');
  list.querySelectorAll('.verify-req-reject').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('revokeVerification')({ soopId: btn.getAttribute('data-soopid') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

// 05번 — 배팅시장 자체 신청함 (verifyRequests). 결과는 저장하지 않고 위 공유 노드로 승인 시 이관된다.
function sbmRenderVerifyRequests() {
  var list = document.getElementById('verify-requests-list');
  if (!list || sbmVerifySubscribed || !window.sbmFirebase) return;
  sbmVerifySubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/verifyRequests'), function (snap) {
    var val = snap.val() || {};
    var reqs = Object.keys(val).map(function (id) { return Object.assign({ id: id }, val[id]); })
      .sort(function (a, b) { return b.submittedAt - a.submittedAt; });
    if (!reqs.length) {
      list.innerHTML = '<li class="audit-empty">대기 중인 인증 신청이 없습니다.</li>';
      return;
    }
    list.innerHTML = reqs.map(function (r) {
      return '<li class="verify-req-item">' +
        '<div class="verify-req-info"><b>' + r.nickname + '</b><span>SOOP 아이디: ' + r.soopId + ' · ' + new Date(r.submittedAt).toLocaleString('ko-KR') + '</span></div>' +
        '<div class="verify-req-actions">' +
        '<button class="verify-req-approve" data-request-id="' + r.id + '" type="button">승인</button>' +
        '<button class="verify-req-reject" data-request-id="' + r.id + '" type="button">반려</button>' +
        '</div></li>';
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
  });
}

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
    if (!window.sbmRealUser) {
      statusEl.textContent = '신청하려면 로그인이 필요합니다 (Ctrl+Enter).';
      statusEl.style.color = 'var(--coral)';
      statusEl.classList.add('show');
      return;
    }
    if (!nicknameInput.value.trim() || !soopIdInput.value.trim()) {
      statusEl.textContent = '닉네임과 SOOP 아이디를 모두 입력해 주세요.';
      statusEl.style.color = 'var(--coral)';
      statusEl.classList.add('show');
      return;
    }
    nicknameInput.disabled = true;
    soopIdInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '신청 처리중...';

    var fb = window.sbmFirebase;
    var newRef = fb.push(fb.ref(window.sbmDb, 'bettingMarket/verifyRequests'));
    fb.set(newRef, {
      nickname: nicknameInput.value.trim(),
      soopId: soopIdInput.value.trim(),
      uid: window.sbmRealUser.uid,
      submittedAt: Date.now(),
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
