// 22번 — 관리 탭 "게시글 홍보 현황"(관리자 전용). 예전엔 이 저장소 전용 함수/노드
// (addPromotedStreamer/removePromotedStreamer, bettingMarket/promotedStreamers)를
// 썼지만, 통합 관리 센터(admin-center)가 이 개념을 게임 전체로 확장하면서
// adminCenter/promotedContent/{gameId}로 옮겼다. 같은 데이터를 두 곳에서 따로
// 관리하는 "미러" 문제(04번에서 반복 확인된 패턴)를 피하려고 이 페이지도
// admin-center의 새 함수(listPromotedContent/addPromotedContent/removePromotedContent)를
// 그대로 호출한다 - codebase가 달라도 같은 프로젝트 안에서는 함수 이름만 맞으면
// 호출 가능(17번 채팅에서도 동일하게 확인된 패턴). 실시간 구독 대신 admin-center와
// 동일하게 액션 후 다시 조회하는 방식으로 바뀌었다(트레이드오프도 admin-center와 동일 -
// 이 개인 체크리스트는 실시간 동기화가 꼭 필요하지 않다).
//
// "인증 스트리머가 홍보했다"가 아니라 "관리자가 이 스트리머 게시판에 홍보글을
// 올렸는지" 스스로 기억해두는 개인 체크리스트라, 인증 여부와 무관하게 모든
// 스트리머를 검색 대상으로 삼는다 — 자동완성은 주제 제안(propose-modal.js)과
// 동일하게 stocks(주식시장과 공유하는 전체 스트리머 목록) 노드를 쓴다.
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

function sbmRenderPromotedStreamers(entries) {
  var el = document.getElementById('promoted-streamers-list');
  if (!el) return;
  if (!entries.length) {
    el.innerHTML = '<li class="audit-empty">아직 추가된 스트리머가 없습니다.</li>';
    return;
  }
  el.innerHTML = entries.map(function (p) {
    var dateText = p.addedAt ? new Date(p.addedAt).toLocaleDateString('ko-KR') : '-';
    return '<li class="promoted-streamer-chip">' +
      '<b>' + sbmEscapeHtml(p.label) + '</b><span>' + dateText + '</span>' +
      '<button class="promoted-streamer-chip-remove" data-id="' + sbmEscapeHtml(p.id) + '" type="button">삭제</button></li>';
  }).join('');

  el.querySelectorAll('.promoted-streamer-chip-remove').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var entryId = btn.getAttribute('data-id');
      btn.disabled = true;
      window.sbmFirebase.httpsCallable('removePromotedContent')({ gameId: 'bettingMarket', entryId: entryId })
        .then(function () { sbmSubscribePromotedStreamers(); })
        .catch(function (e) { alert(e.message); btn.disabled = false; });
    });
  });
}

// 함수 이름은 js/nav.js가 그대로 호출하므로 유지한다 - 이제는 실시간 구독이
// 아니라 관리 탭을 열 때(그리고 추가/삭제 직후) 다시 조회하는 방식이다.
function sbmSubscribePromotedStreamers() {
  if (!window.sbmFirebase) return;
  window.sbmFirebase.httpsCallable('listPromotedContent')().then(function (result) {
    var games = (result.data && result.data.games) || [];
    var mine = games.find(function (g) { return g.id === 'bettingMarket'; });
    sbmRenderPromotedStreamers(mine ? mine.entries : []);
  }).catch(function (e) {
    console.error('게시글 홍보 현황 조회 실패:', e);
  });
}

(function () {
  var input = document.getElementById('promoted-streamer-input');
  var addBtn = document.getElementById('promoted-streamer-add-btn');
  if (!input || !addBtn || !window.sbmFirebase) return;

  addBtn.addEventListener('click', function () {
    var label = input.value.trim();
    if (!label) { alert('스트리머 이름을 입력해 주세요.'); return; }
    addBtn.disabled = true;
    window.sbmFirebase.httpsCallable('addPromotedContent')({ gameId: 'bettingMarket', label: label })
      .then(function () { input.value = ''; sbmSubscribePromotedStreamers(); })
      .catch(function (e) { alert(e.message); })
      .then(function () { addBtn.disabled = false; });
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });
})();
