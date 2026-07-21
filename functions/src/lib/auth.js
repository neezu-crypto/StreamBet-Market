const { HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { ADMIN_EMAIL } = require('../constants');

// uid 위변조 검증 원칙 (11번) — 대상 uid는 항상 request.auth.uid에서만 가져온다.
function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

function isAdminEmail(email) {
  return !!email && email === ADMIN_EMAIL;
}

// 페이지 접속 시 자동으로 생성되는 익명 계정은 마켓 등 공개 데이터를 읽을 수 있게 하기 위한 것으로,
// 재화가 걸린 기능(배팅, 제안, 환전, 출석보상, 신고 등)은 실제(비익명) 계정만 사용할 수 있다.
// 그렇지 않으면 익명 계정을 계속 새로 발급받아 09번이 막으려는 "즉석 다중 계정" 어뷰징이 그대로 재현된다.
function requireRealAccount(request) {
  const uid = requireAuth(request);
  const provider = request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
  if (provider === 'anonymous') {
    throw new HttpsError('permission-denied', '게스트(익명) 계정은 이 기능을 사용할 수 없습니다. Google 로그인 후 다시 시도해 주세요.');
  }
  return uid;
}

function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!isAdminEmail(email)) {
    throw new HttpsError('permission-denied', '관리자만 수행할 수 있습니다.');
  }
  return uid;
}

// 05번 — 인증 스트리머 여부는 공유 streamerVerifications 노드의 uid 필드로 판별한다.
async function isVerifiedStreamerUid(uid) {
  const db = getDatabase();
  const snap = await db
    .ref('streamerVerifications')
    .orderByChild('uid')
    .equalTo(uid)
    .limitToFirst(1)
    .get();
  return snap.exists();
}

// 10번 — 판정/검증 권한은 관리자 또는 인증 스트리머만 가능.
async function requireAdminOrVerifiedStreamer(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (isAdminEmail(email)) return { uid, role: 'admin' };
  if (await isVerifiedStreamerUid(uid)) return { uid, role: 'streamer' };
  throw new HttpsError('permission-denied', '관리자 또는 인증 스트리머만 수행할 수 있습니다.');
}

module.exports = {
  requireAuth,
  requireRealAccount,
  isAdminEmail,
  requireAdmin,
  isVerifiedStreamerUid,
  requireAdminOrVerifiedStreamer,
};
