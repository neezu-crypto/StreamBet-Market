// 배팅 주제 제안 시 검색해도 없는 스트리머를 추가해 달라는 요청 접수함 (관리자 전용 처리).
var sbmStreamerRequestsCache = {};
var sbmStreamerRequestsSubscribed = false;

function sbmRenderStreamerRequests() {
  var list = document.getElementById('streamer-requests-list');
  if (!list || sbmStreamerRequestsSubscribed || !window.sbmFirebase) return;
  sbmStreamerRequestsSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/streamerRequests'), function (snap) {
    sbmStreamerRequestsCache = snap.val() || {};
    sbmRenderStreamerRequestsList();
  });
}

function sbmRenderStreamerRequestsList() {
  var list = document.getElementById('streamer-requests-list');
  if (!list) return;
  var isAdmin = !!window.sbmIsAdmin;
  var reqs = Object.keys(sbmStreamerRequestsCache).map(function (id) { return Object.assign({ id: id }, sbmStreamerRequestsCache[id]); })
    .sort(function (a, b) { return b.requestedAt - a.requestedAt; });
  if (!reqs.length) {
    list.innerHTML = '<li class="audit-empty">대기 중인 스트리머 추가 요청이 없습니다.</li>';
    return;
  }
  list.innerHTML = reqs.map(function (r) {
    var actions = isAdmin
      ? '<button class="verify-req-approve streamer-req-approve" data-request-id="' + r.id + '" type="button">처리 완료</button>' +
        '<button class="verify-req-reject streamer-req-reject" data-request-id="' + r.id + '" type="button">반려</button>'
      : '';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(r.name) + '</b><span>' + new Date(r.requestedAt).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="verify-req-actions">' + actions + '</div></li>';
  }).join('');

  list.querySelectorAll('.streamer-req-approve').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('approveStreamerRequest')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
  list.querySelectorAll('.streamer-req-reject').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('dismissStreamerRequest')({ requestId: btn.getAttribute('data-request-id') })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

document.addEventListener('sbm-auth-changed', sbmRenderStreamerRequestsList);
