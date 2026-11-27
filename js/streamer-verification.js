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

// 05번 — 홍보 배너는 방문자 전원(로그인 여부 무관)에게 무조건 걸리는 전역 리스너라,
// 자주 안 바뀌는 인증 목록을 실시간으로 유지할 필요가 없다. 페이지 로드 시 1회만 받아온다.
function sbmFetchVerifiedStreamersOnce() {
  if (!window.sbmFirebase) return;
  var fb = window.sbmFirebase;
  fb.get(fb.ref(window.sbmDb, 'streamerVerificationsPublic')).then(function (snap) {
    sbmVerifiedCache = snap.val() || {};
    sbmRenderVerifiedBanner();
    sbmRenderVerifiedStreamers();
  });
}

// 관리 탭에서 승인 · 반려 · 인증 해제를 실제로 다루는 소수(관리자 · 인증 스트리머)에게만
// 실시간 구독을 시작한다 — 관리 탭 진입 시(nav.js)에만 호출되므로 전체 방문자에게 걸리지 않는다.
function sbmSubscribeVerifiedStreamers() {
  if (sbmVerifiedSubscribed || !window.sbmFirebase) return;
  sbmVerifiedSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'streamerVerificationsPublic'), function (snap) {
    sbmVerifiedCache = snap.val() || {};
    sbmRenderVerifiedBanner();
    sbmRenderVerifiedStreamers();
  });
}

function sbmRenderVerifiedBanner() {
  var track = document.getElementById('verified-track');
  if (!track) return;
  // 인증하기 버튼은 좌측에 고정 노출돼야 하므로(스크롤되는 홍보 이미지와 별개), 이 트랙
  // 안으로 옮기지 않는다 — verified-row에서 viewport 앞에 별도로 위치한다.
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
      var soopId = btn.getAttribute('data-soopid');
      if (!soopId) {
        alert('SOOP 아이디가 없어서 인증 해제할 수 없습니다. 먼저 SOOP 아이디를 입력해 주세요.');
        return;
      }
      if (!confirm('SOOP 아이디 "' + soopId + '"의 인증을 해제할까요? 판정 권한과 배너 노출이 즉시 사라집니다.')) return;
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('revokeVerification')({ soopId: soopId })
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
      ? '<button class="verify-req-approve" data-request-id="' + r.id + '" data-collision="' + (r.soopIdAlreadyVerifiedByOther ? '1' : '') + '" type="button">승인</button>' +
        '<button class="verify-req-reject" data-request-id="' + r.id + '" type="button">반려</button>'
      : '';
    var warning = r.soopIdAlreadyVerifiedByOther
      ? '<div class="verify-req-warning">⚠️ 이미 다른 계정으로 인증된 SOOP 아이디입니다 — 본인의 재신청이 맞는지 반드시 확인 후 승인하세요.</div>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(r.nickname) + '</b><span>SOOP 아이디: ' + sbmEscapeHtml(r.soopId) + ' · ' + new Date(r.submittedAt).toLocaleString('ko-KR') + '</span>' + warning + '</div>' +
      '<div class="verify-req-actions">' + actions + '</div></li>';
  }).join('');

  list.querySelectorAll('.verify-req-approve').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-collision') === '1' &&
        !confirm('이미 다른 계정으로 인증된 SOOP 아이디입니다. 승인하면 기존 인증(판정 권한 등)이 이 신청자의 계정으로 넘어갑니다. 본인이 맞는지 확인했나요?')) {
        return;
      }
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

// 이미 인증 승인된 스트리머에게는 "인증하기" 버튼이 의미가 없으니 숨긴다.
function sbmUpdateVerifyCtaVisibility() {
  var alreadyVerified = !!window.sbmIsVerifiedStreamer;
  var bannerCta = document.getElementById('open-verify-modal');
  var loginModalCta = document.getElementById('login-verify-btn');
  if (bannerCta) bannerCta.style.display = alreadyVerified ? 'none' : '';
  if (loginModalCta) loginModalCta.style.display = alreadyVerified ? 'none' : '';
}

document.addEventListener('sbm-auth-changed', function () {
  sbmRenderVerifyRequestsList();
  sbmRenderVerifiedStreamers();
  sbmUpdateVerifyCtaVisibility();
});

// 스트리머 인증 신청 창은 시리즈 공통 로그인 창(series-kit login-modal)의 스트리머 인증 화면을 쓴다(2026-11-28).
document.addEventListener('click', function (e) {
  if (e.target.closest('#open-verify-modal')) window.sbmOpenVerifyModal && window.sbmOpenVerifyModal();
});

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

  sbmFetchVerifiedStreamersOnce();
})();
