// 16번 — 관리 탭 "게시글 홍보 현황"(관리자 전용). 배팅시장 홍보를 완료한 인증
// 스트리머를 검색(datalist 자동완성, streamer-verification.js의 인증 목록
// 캐시 재사용)해서 추가해두고 날짜와 함께 보여준다. RTDB 규칙상 관리자만
// 읽을 수 있는 경로라 다른 관리자 전용 목록과 동일하게 구독 가드를 둔다.
var sbmPromotedStreamersSubscribed = false;

function sbmRefreshPromotedStreamerDatalist() {
  var datalist = document.getElementById('promoted-streamer-datalist');
  if (!datalist) return;
  var cache = window.sbmVerifiedCache || {};
  var names = Object.keys(cache).map(function (key) { return cache[key].nickname; }).filter(Boolean);
  datalist.innerHTML = names.map(function (n) {
    return '<option value="' + sbmEscapeHtml(n) + '"></option>';
  }).join('');
}

function sbmRenderPromotedStreamers(list) {
  var el = document.getElementById('promoted-streamers-list');
  if (!el) return;
  var keys = Object.keys(list || {}).sort(function (a, b) {
    return (list[b].addedAt || 0) - (list[a].addedAt || 0);
  });
  if (!keys.length) {
    el.innerHTML = '<li class="audit-empty">아직 추가된 스트리머가 없습니다.</li>';
    return;
  }
  el.innerHTML = keys.map(function (key) {
    var p = list[key];
    var dateText = p.addedAt ? new Date(p.addedAt).toLocaleDateString('ko-KR') : '-';
    return '<li class="verify-req-item">' +
      '<div class="verify-req-info"><b>' + sbmEscapeHtml(p.nickname) + '</b><span>' + dateText + ' 추가</span></div>' +
      '<div class="verify-req-actions"><button class="verify-req-reject" data-id="' + sbmEscapeHtml(key) + '" type="button">삭제</button></div></li>';
  }).join('');

  el.querySelectorAll('.verify-req-reject').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-id');
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('removePromotedStreamer')({ id: id })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

function sbmSubscribePromotedStreamers() {
  if (sbmPromotedStreamersSubscribed || !window.sbmFirebase) return;
  sbmPromotedStreamersSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/promotedStreamers'), function (snap) {
    sbmRenderPromotedStreamers(snap.val() || {});
  });
}

(function () {
  var input = document.getElementById('promoted-streamer-input');
  var addBtn = document.getElementById('promoted-streamer-add-btn');
  if (!input || !addBtn || !window.sbmFirebase) return;

  addBtn.addEventListener('click', function () {
    var nickname = input.value.trim();
    if (!nickname) { alert('스트리머 이름을 입력해 주세요.'); return; }
    addBtn.disabled = true;
    window.sbmFirebase.httpsCallable('addPromotedStreamer')({ nickname: nickname })
      .then(function () { input.value = ''; })
      .catch(function (e) { alert(e.message); })
      .then(function () { addBtn.disabled = false; });
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });
})();
