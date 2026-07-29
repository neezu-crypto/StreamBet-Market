const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireAdmin, assertNotBanned } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { avatarUrlFor } = require('./lib/avatar');
const { SOOP_ID_RE, NICKNAME_FORBIDDEN_RE } = require('./constants');

// 인증 스트리머가 이 배팅시장에서 인게임 닉네임을 한 번도 설정한 적이 없으면(프로필 없음),
// 랭킹 등에 "유저XXXXXX" 폴백 대신 방송 닉네임이 바로 보이도록 초기값을 채워준다. 이미 본인이
// 직접 정한 닉네임이 있으면 절대 덮어쓰지 않는다 — 자동 채움은 "빈 프로필 채우기"로만 한정한다.
async function fillProfileIfEmpty(db, uid, nickname, soopId) {
  const profileRef = db.ref('bettingMarket/profiles/' + uid);
  const snap = await profileRef.get();
  const current = snap.val();
  if (current && current.nickname) return;
  await profileRef.update({ nickname, soopId, avatarUrl: avatarUrlFor(soopId) });
}

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

// streamerVerifications는 주식시장과 공유하는 노드인데, 그쪽 앱은 SOOP 아이디
// 필드 없이 닉네임만으로 기존 레코드를 찾는다 — 그래서 배팅시장이 SOOP 아이디로만
// 기존 레코드를 찾으면, 주식시장 쪽에서 먼저 만들어진(SOOP 아이디 없는) 레코드를
// 못 찾고 같은 사람인데 uid가 다른 중복 레코드를 새로 만들어버리는 문제가 실제로
// 있었다. SOOP 아이디로 먼저 찾고, 없으면 닉네임으로도 찾아서 두 앱 어느 쪽에서
// 먼저 인증됐어도 같은 레코드로 합쳐지게 한다.
async function findExistingStreamerRecord(db, nickname, soopId) {
  if (soopId) {
    const bySoopId = await db.ref('streamerVerifications').orderByChild('soopId').equalTo(soopId).limitToFirst(1).get();
    if (bySoopId.exists()) return bySoopId;
  }
  return db.ref('streamerVerifications').orderByChild('nickname').equalTo(nickname).limitToFirst(1).get();
}

// 05번 — 스트리머 인증 승인. 공유 streamerVerifications 노드에 Cloud Functions가 직접 기록한다.
// 동일 SOOP 아이디 또는 동일 닉네임으로 재신청 시 새 레코드를 만들지 않고 uid 필드만 갱신한다.
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

  const existingSnap = await findExistingStreamerRecord(db, nickname, soopId);

  if (existingSnap.exists()) {
    const existingKey = Object.keys(existingSnap.val())[0];
    const oldUid = existingSnap.val()[existingKey].uid;
    // soopId도 같이 채워 넣는다 — 기존 레코드가 주식시장 쪽에서 만들어져 SOOP
    // 아이디가 비어있던 경우, 이번 승인으로 같이 보완된다.
    await db.ref('streamerVerifications/' + existingKey).update({ uid, soopId });
    // 11번 — 규칙(rules)이 "인증 스트리머인지"를 O(1)로 확인할 수 있도록 uid 기준 미러 노드를 유지한다.
    if (oldUid && oldUid !== uid) await db.ref('bettingMarket/verifiedStreamerUids/' + oldUid).remove();
    await db.ref('bettingMarket/verifiedStreamerUids/' + uid).set(true);
    await reqRef.remove();
    await fillProfileIfEmpty(db, uid, nickname, soopId);
    await logAudit(adminUid, adminName, '스트리머 인증 재신청 승인 (uid 갱신)', nickname + ' (' + soopId + ')');
    const { recomputeRankingsAfter } = require('./rankings');
    await recomputeRankingsAfter('approveVerification');
    return { status: 'approved', mode: 'uid-updated' };
  }

  const newRef = db.ref('streamerVerifications').push();
  await newRef.set({ nickname, soopId, uid, verifiedAt: Date.now() });
  await db.ref('bettingMarket/verifiedStreamerUids/' + uid).set(true);
  await reqRef.remove();
  await fillProfileIfEmpty(db, uid, nickname, soopId);
  await logAudit(adminUid, adminName, '스트리머 인증 승인', nickname + ' (' + soopId + ')');
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('approveVerification');
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
