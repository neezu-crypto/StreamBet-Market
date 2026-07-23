const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireAdmin, assertNotBanned } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { SOOP_ID_RE, NICKNAME_FORBIDDEN_RE } = require('./constants');

// 05번 — 스트리머 인증 신청은 로그인 없이도 가능해야 한다(익명 계정 포함). 방송 인증은
// 재화가 걸린 행위가 아니라 관리자가 수기로 검수하는 절차라 requireRealAccount를 쓰지 않는다.
// 주식시장에서 이미 같은 닉네임으로 인증된 스트리머가 있으면, 익명 세션의 임시 uid 대신
// 그 스트리머가 주식시장에서 실제로 쓰던 uid를 그대로 이어받는다 — 그래야 나중에 그 계정으로
// 로그인했을 때 이 앱에서도 동일한 uid 기준으로 인증 스트리머 권한이 인식된다.
const submitVerificationRequest = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { nickname, soopId } = request.data || {};
  const trimmedNickname = typeof nickname === 'string' ? nickname.trim() : '';
  const trimmedSoopId = typeof soopId === 'string' ? soopId.trim() : '';

  if (!trimmedNickname || trimmedNickname.length > 20 || NICKNAME_FORBIDDEN_RE.test(trimmedNickname)) {
    throw new HttpsError('invalid-argument', '닉네임은 20자 이하, 사용할 수 없는 문자 없이 입력해 주세요.');
  }
  if (!SOOP_ID_RE.test(trimmedSoopId)) {
    throw new HttpsError('invalid-argument', 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.');
  }

  const db = getDatabase();
  const existingSnap = await db
    .ref('streamerVerifications')
    .orderByChild('nickname')
    .equalTo(trimmedNickname)
    .limitToFirst(1)
    .get();
  const finalUid = existingSnap.exists() ? Object.values(existingSnap.val())[0].uid : uid;

  // 이미 다른 uid로 인증된 SOOP 아이디로 신청하는 경우(공개 정보라 누구나 입력 가능) —
  // 승인 시 기존 인증 스트리머의 판정 권한이 신청자에게 그대로 넘어가므로, 관리자가 검수
  // 화면에서 이 사실을 명확히 인지할 수 있도록 플래그를 남긴다.
  const soopIdMatchSnap = await db
    .ref('streamerVerifications')
    .orderByChild('soopId')
    .equalTo(trimmedSoopId)
    .limitToFirst(1)
    .get();
  let soopIdAlreadyVerifiedByOther = false;
  if (soopIdMatchSnap.exists()) {
    const existingRecord = Object.values(soopIdMatchSnap.val())[0];
    soopIdAlreadyVerifiedByOther = existingRecord.uid !== finalUid;
  }

  const newRef = db.ref('bettingMarket/verifyRequests').push();
  await newRef.set({
    nickname: trimmedNickname,
    soopId: trimmedSoopId,
    uid: finalUid,
    submittedAt: Date.now(),
    soopIdAlreadyVerifiedByOther,
  });
  return { status: 'submitted' };
});

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
    const oldUid = existingSnap.val()[existingKey].uid;
    await db.ref('streamerVerifications/' + existingKey).update({ uid });
    // 11번 — 규칙(rules)이 "인증 스트리머인지"를 O(1)로 확인할 수 있도록 uid 기준 미러 노드를 유지한다.
    if (oldUid && oldUid !== uid) await db.ref('bettingMarket/verifiedStreamerUids/' + oldUid).remove();
    await db.ref('bettingMarket/verifiedStreamerUids/' + uid).set(true);
    await reqRef.remove();
    await logAudit(adminUid, adminName, '스트리머 인증 재신청 승인 (uid 갱신)', nickname + ' (' + soopId + ')');
    return { status: 'approved', mode: 'uid-updated' };
  }

  const newRef = db.ref('streamerVerifications').push();
  await newRef.set({ nickname, soopId, uid, verifiedAt: Date.now() });
  await db.ref('bettingMarket/verifiedStreamerUids/' + uid).set(true);
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
  const record = snap.val()[key];
  await db.ref('streamerVerifications/' + key).remove();
  if (record.uid) await db.ref('bettingMarket/verifiedStreamerUids/' + record.uid).remove();
  await logAudit(adminUid, adminName, '스트리머 인증 해제', record.nickname + ' (' + soopId + ')');
  return { status: 'revoked' };
});

// 05번 — streamerVerifications는 주식시장과 공유하는 노드라, soopId 필드를 나중에
// 스키마에 추가하기 전부터 있던 레거시 레코드는 soopId가 비어있다. 관리자가
// 관리 탭에서 그런 레코드에 SOOP 아이디를 나중에 채워 넣을 수 있게 한다.
const setVerifiedSoopId = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { recordId, soopId } = request.data || {};
  const id = (soopId || '').trim();
  if (!recordId || !id) throw new HttpsError('invalid-argument', 'SOOP 아이디를 입력해 주세요.');
  if (!SOOP_ID_RE.test(id)) throw new HttpsError('invalid-argument', 'SOOP 아이디는 영문 소문자/숫자 2~20자여야 합니다.');

  const db = getDatabase();
  const ref = db.ref('streamerVerifications/' + recordId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '인증된 스트리머를 찾을 수 없습니다.');

  const dupSnap = await db.ref('streamerVerifications').orderByChild('soopId').equalTo(id).get();
  const dupKeys = dupSnap.exists() ? Object.keys(dupSnap.val()) : [];
  if (dupKeys.some((key) => key !== recordId)) {
    throw new HttpsError('failed-precondition', '이미 다른 스트리머가 사용 중인 SOOP 아이디입니다.');
  }

  await ref.update({ soopId: id });
  await logAudit(adminUid, adminName, 'SOOP 아이디 입력', snap.val().nickname + ' → ' + id);
  return { status: 'updated' };
});

module.exports = { submitVerificationRequest, approveVerification, rejectVerification, revokeVerification, setVerifiedSoopId };
