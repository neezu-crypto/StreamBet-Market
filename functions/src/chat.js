const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAdminOrVerifiedStreamer } = require('./lib/auth');
const { CHAT_MESSAGE_MAX_LENGTH } = require('./constants');

// 관리 탭 채팅 — 관리자 · 인증 스트리머끼리 실시간으로 소통하는 용도. 재화가 걸려있지 않지만
// bettingMarket 아래 다른 관리자 전용 데이터와 동일하게 클라이언트 직접 쓰기는 막고
// Cloud Function을 거치게 해 정지 계정 차단 · 길이 검증을 서버에서 항상 보장한다.
const sendAdminChatMessage = onCall(async (request) => {
  const { uid, role } = await requireAdminOrVerifiedStreamer(request);
  const text = ((request.data || {}).text || '').trim();
  if (!text) throw new HttpsError('invalid-argument', '메시지를 입력해 주세요.');
  if (text.length > CHAT_MESSAGE_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', '메시지는 ' + CHAT_MESSAGE_MAX_LENGTH + '자 이하로 입력해 주세요.');
  }

  const db = getDatabase();
  const profileSnap = await db.ref('bettingMarket/profiles/' + uid).get();
  const profile = profileSnap.val() || {};
  const name = profile.nickname || request.auth.token.name || request.auth.token.email || uid;

  const ref = db.ref('bettingMarket/adminChat').push();
  await ref.set({ uid, name, avatarUrl: profile.avatarUrl || '', role, text, at: Date.now() });
  return { messageId: ref.key };
});

module.exports = { sendAdminChatMessage };
