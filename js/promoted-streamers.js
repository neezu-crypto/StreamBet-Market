// 16번 — 관리 탭 "게시글 홍보 현황"(관리자 전용). "인증 스트리머가 홍보했다"가
// 아니라 "관리자가 이 스트리머 게시판에 홍보글을 올렸는지" 스스로 기억해두는
// 개인 체크리스트라, 인증 여부와 무관하게 모든 스트리머를 검색 대상으로 삼는다
// — 자동완성은 주제 제안(propose-modal.js)과 동일하게 stocks(주식시장과 공유하는
// 전체 스트리머 목록) 노드를 쓴다. 자주 안 바뀌는 참조 데이터라 페이지당 1회만 받아온다.
var sbmPromotedStreamersSubscribed = false;
var sbmPromotedStreamerNamesLoaded = false;

function sbmRefreshPromotedStreamerDatalist() {
  var datalist = document.getElementById('promoted-streamer-datalist');
  if (!datalist || sbmPromotedStreamerNamesLoaded || !window.sbmFirebase || !window.sbmDb) return;
  sbmPromotedStreamerNamesLoaded = true;
  var fb = window.sbmFirebase;
  fb.get(fb.ref(window.sbmDb, 'stocks')).then(function (snap) {
    var val = snap.val() || {};
    var names = Object.keys(val).map(function (id) { return val[id].name; }).filter(Boolean);
    datalist.innerHTML = names.map(function (n) {
      return '<option value="' + sbmEscapeHtml(n) + '"></option>';
    }).join('');
  }).catch(function () {
    sbmPromotedStreamerNamesLoaded = false; // 실패 시 다음 진입 때 재시도 가능하게
  });
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
    return '<li class="promoted-streamer-chip">' +
      '<b>' + sbmEscapeHtml(p.nickname) + '</b><span>' + dateText + '</span>' +
      '<button class="promoted-streamer-chip-remove" data-id="' + sbmEscapeHtml(key) + '" type="button">삭제</button></li>';
  }).join('');

  el.querySelectorAll('.promoted-streamer-chip-remove').forEach(function (btn) {
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
