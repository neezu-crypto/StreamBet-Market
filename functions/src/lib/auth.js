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
  isAdminEmail,
  requireAdmin,
  isVerifiedStreamerUid,
  requireAdminOrVerifiedStreamer,
};
