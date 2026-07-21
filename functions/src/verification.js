const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');

// 05번 — 스트리머 인증 승인. 공유 streamerVerifications 노드에 Cloud Functions가 직접 기록한다.
// 동일 SOOP 아이디로 재신청 시 새 레코드를 만들지 않고 uid 필드만 갱신한다.
const approveVerification = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const db = getDatabase();
  const reqRef = db.ref('bettingMarket/verifyRequests/' + requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists()) throw new HttpsError('not-found', '인증 신청을 찾을 수 없습니다.');
  const { nickname, soopId, uid } = reqSnap.val();

  const existingSnap = await db
    .ref('streamerVerifications')
    .orderByChild('soopId')
    .equalTo(soopId)
    .limitToFirst(1)
    .get();

  if (existingSnap.exists()) {
    const existingKey = Object.keys(existingSnap.val())[0];
    await db.ref('streamerVerifications/' + existingKey).update({ uid });
    await reqRef.remove();
    await logAudit(adminUid, adminName, '스트리머 인증 재신청 승인 (uid 갱신)', nickname + ' (' + soopId + ')');
    return { status: 'approved', mode: 'uid-updated' };
  }

  const newRef = db.ref('streamerVerifications').push();
  await newRef.set({ nickname, soopId, uid, verifiedAt: Date.now() });
  await reqRef.remove();
  await logAudit(adminUid, adminName, '스트리머 인증 승인', nickname + ' (' + soopId + ')');
  return { status: 'approved', mode: 'created' };
});

const rejectVerification = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const reqRef = getDatabase().ref('bettingMarket/verifyRequests/' + requestId);
  const reqSnap = await reqRef.get();
  const req = reqSnap.val();
  await reqRef.remove();
  await logAudit(adminUid, adminName, '스트리머 인증 반려', req ? req.nickname + ' (' + req.soopId + ')' : requestId);
  return { status: 'rejected' };
});

// 05번 — 이미 인증된 스트리머도 관리자가 인증 해제 가능 (공유 노드에서 제거)
const revokeVerification = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { soopId } = request.data || {};
  if (!soopId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');

  const db = getDatabase();
  const snap = await db.ref('streamerVerifications').orderByChild('soopId').equalTo(soopId).limitToFirst(1).get();
  if (!snap.exists()) throw new HttpsError('not-found', '인증된 스트리머를 찾을 수 없습니다.');
  const key = Object.keys(snap.val())[0];
  const nickname = snap.val()[key].nickname;
  await db.ref('streamerVerifications/' + key).remove();
  await logAudit(adminUid, adminName, '스트리머 인증 해제', nickname + ' (' + soopId + ')');
  return { status: 'revoked' };
});

module.exports = { approveVerification, rejectVerification, revokeVerification };
