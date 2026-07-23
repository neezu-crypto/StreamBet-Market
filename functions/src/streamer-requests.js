const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, requireAdmin, assertNotBanned } = require('./lib/auth');
const { logAudit } = require('./lib/audit');
const { NICKNAME_FORBIDDEN_RE } = require('./constants');

const STREAMER_REQUEST_NAME_MAX = 20;

// 배팅 주제 제안 시 검색해도 스트리머가 없을 때 추가를 요청하는 기능. stocks는 주식시장과
// 공유하는 노드라 이 앱에서 직접 새 항목을 만들지 않고, 관리자가 검토 후 주식시장 쪽에
// 별도로 등록하는 걸 전제로 접수함만 관리한다(로그인 없이도 신청 가능).
const submitStreamerRequest = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const name = ((request.data && request.data.name) || '').trim();
  if (!name) throw new HttpsError('invalid-argument', '스트리머 이름을 입력해 주세요.');
  if (name.length > STREAMER_REQUEST_NAME_MAX) {
    throw new HttpsError('invalid-argument', '스트리머 이름은 ' + STREAMER_REQUEST_NAME_MAX + '자 이하로 입력해 주세요.');
  }
  if (NICKNAME_FORBIDDEN_RE.test(name)) {
    throw new HttpsError('invalid-argument', '사용할 수 없는 문자가 포함되어 있습니다.');
  }

  const ref = getDatabase().ref('bettingMarket/streamerRequests').push();
  await ref.set({ name, requestedBy: uid, requestedAt: Date.now() });
  return { requestId: ref.key };
});

// 관리자 전용 — stocks 등록은 주식시장 쪽에서 별도로 처리한다는 전제로, 여기서는 접수함에서
// 제거(처리 완료 표시)만 한다.
const approveStreamerRequest = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const ref = getDatabase().ref('bettingMarket/streamerRequests/' + requestId);
  const snap = await ref.get();
  if (!snap.exists()) throw new HttpsError('not-found', '요청을 찾을 수 없습니다.');
  const req = snap.val();
  await ref.remove();
  await logAudit(adminUid, adminName, '스트리머 추가 요청 처리 완료', req.name);
  return { status: 'approved' };
});

const dismissStreamerRequest = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { requestId } = request.data || {};
  if (!requestId) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const ref = getDatabase().ref('bettingMarket/streamerRequests/' + requestId);
  const snap = await ref.get();
  const req = snap.val();
  await ref.remove();
  await logAudit(adminUid, adminName, '스트리머 추가 요청 반려', req ? req.name : requestId);
  return { status: 'dismissed' };
});

module.exports = { submitStreamerRequest, approveStreamerRequest, dismissStreamerRequest };
