const { onCall } = require('firebase-functions/v2/https');
const { requireAuth, isAdmin } = require('./lib/auth');

// 09번/13번 — 클라이언트가 로컬에서 이메일 문자열을 직접 비교하던 관리자
// UI 판별을 서버 확인으로 옮기기 위한 가벼운 전용 함수. adminCenter/adminUids는
// .read:false라 클라이언트가 직접 읽을 수 없으므로, 판별 결과만 반환한다.
const whoAmI = onCall(async (request) => {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  return { isAdmin: await isAdmin(uid, email) };
});

module.exports = { whoAmI };
