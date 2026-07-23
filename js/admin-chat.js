// 관리 탭 채팅 — 관리자 · 인증 스트리머끼리 실시간으로 대화. 메시지는 항상
// sendAdminChatMessage 함수를 거쳐 기록되며, 여기서는 읽기 구독과 전송 UI만 담당한다.
// 서버가 매 전송마다 최근 ADMIN_CHAT_CAP개로 잘라내지만(functions/src/chat.js), 클라이언트도
// 전체를 내려받지 않고 최근 200개만 쿼리로 요청한다.
var sbmAdminChatSubscribed = false;

function sbmRenderAdminChat() {
  var list = document.getElementById('admin-chat-messages');
  if (!list || sbmAdminChatSubscribed || !window.sbmFirebase) return;
  sbmAdminChatSubscribed = true;
  var fb = window.sbmFirebase;

  var q = fb.query(fb.ref(window.sbmDb, 'bettingMarket/adminChat'), fb.limitToLast(200));
  fb.onValue(q, function (snap) {
    var val = snap.val() || {};
    // 컨테이너가 flex-direction:column-reverse라 DOM상 첫 항목이 화면 맨 아래에 온다 —
    // 최신 메시지가 아래에 쌓이도록 최신순(내림차순)으로 정렬해서 넣는다.
    var messages = Object.keys(val).map(function (k) { return val[k]; })
      .sort(function (a, b) { return b.at - a.at; });
    if (!messages.length) {
      list.innerHTML = '<li class="audit-empty">아직 대화가 없습니다. 첫 메시지를 남겨보세요.</li>';
      return;
    }
    var myUid = window.sbmUser && window.sbmUser.uid;
    // column-reverse에서는 scrollTop 0이 맨 아래(최신)다 — 사용자가 위로 스크롤해 과거를
    // 보고 있지 않을 때만 새 메시지가 와도 계속 맨 아래에 붙어있게 한다.
    var atBottom = list.scrollTop <= 40;
    list.innerHTML = messages.map(function (m) {
      var roleTag = m.role === 'admin' ? '<span class="admin-chat-role admin">관리자</span>' : '<span class="admin-chat-role streamer">인증 스트리머</span>';
      var mine = m.uid === myUid;
      var avatarHtml = m.avatarUrl
        ? '<img class="admin-chat-avatar" src="' + sbmEscapeHtml(m.avatarUrl) + '" alt="">'
        : '<span class="admin-chat-avatar-fallback">' + sbmEscapeHtml((m.name || '?').charAt(0)) + '</span>';
      return '<li class="admin-chat-msg' + (mine ? ' mine' : '') + '">' +
        avatarHtml +
        '<div class="admin-chat-bubble">' +
        '<div class="admin-chat-msg-head"><b>' + sbmEscapeHtml(m.name) + '</b>' + roleTag +
        '<span class="audit-time">' + new Date(m.at).toLocaleString('ko-KR') + '</span></div>' +
        '<div class="admin-chat-msg-text">' + sbmEscapeHtml(m.text) + '</div></div></li>';
    }).join('');
    if (atBottom) list.scrollTop = 0;
  });
}

(function () {
  var input = document.getElementById('admin-chat-input');
  var sendBtn = document.getElementById('admin-chat-send-btn');
  if (!input || !sendBtn) return;

  function send() {
    var text = input.value.trim();
    if (!text || !window.sbmFirebase) return;
    input.disabled = true;
    sendBtn.disabled = true;
    window.sbmFirebase.httpsCallable('sendAdminChatMessage')({ text: text })
      .then(function () {
        input.value = '';
      })
      .catch(function (e) { alert(e.message); })
      .then(function () {
        input.disabled = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
})();
