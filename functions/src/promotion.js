const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');

// 16번 — 게시글 홍보 현황(관리자 전용). 관리자가 배팅시장 홍보를 완료한 스트리머를
// 인증 스트리머 목록에서 검색해 추가해두고, 누구를 언제 홍보했는지 기록해둔다.
// 임의 이름이 아니라 실제 인증된 스트리머만 추가할 수 있도록 서버에서도 확인한다
// (프론트 자동완성만으로는 요청 위조를 막을 수 없음).
const addPromotedStreamer = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const nickname = ((request.data && request.data.nickname) || '').trim();
  if (!nickname) throw new HttpsError('invalid-argument', '스트리머 이름을 입력해 주세요.');

  const verifiedSnap = await getDatabase().ref('streamerVerifications').get();
  const verified = verifiedSnap.val() || {};
  const match = Object.keys(verified)
    .map((key) => verified[key])
    .find((v) => v.nickname === nickname);
  if (!match) throw new HttpsError('invalid-argument', '인증된 스트리머 중에서 선택해 주세요.');

  const listRef = getDatabase().ref('bettingMarket/promotedStreamers');
  const existingSnap = await listRef.get();
  const existing = existingSnap.val() || {};
  const alreadyAdded = Object.keys(existing).some((key) => existing[key].nickname === nickname);
  if (alreadyAdded) throw new HttpsError('failed-precondition', '이미 추가된 스트리머입니다.');

  const ref = listRef.push();
  await ref.set({ nickname, soopId: match.soopId || '', addedAt: Date.now(), addedBy: adminUid });
  await logAudit(adminUid, adminName, '게시글 홍보 현황 추가', nickname);
  return { id: ref.key };
});

const removePromotedStreamer = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const { id } = request.data || {};
  if (!id) throw new HttpsError('invalid-argument', '요청이 올바르지 않습니다.');
  const ref = getDatabase().ref('bettingMarket/promotedStreamers/' + id);
  const snap = await ref.get();
  const entry = snap.val();
  await ref.remove();
  await logAudit(adminUid, adminName, '게시글 홍보 현황 삭제', entry ? entry.nickname : id);
  return { status: 'removed' };
});

module.exports = { addPromotedStreamer, removePromotedStreamer };
