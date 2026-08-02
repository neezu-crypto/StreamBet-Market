const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAdmin } = require('./lib/auth');
const { logAudit } = require('./lib/audit');

const PROMOTED_STREAMER_NAME_MAX = 40;

// 16번 — 게시글 홍보 현황(관리자 전용). "이 스트리머가 배팅시장을 홍보했다"가
// 아니라 "관리자가 이 스트리머 게시판에 홍보글을 올렸는지"를 스스로 기억해두는
// 개인 체크리스트라, 인증 여부와 무관하게 모든 스트리머를 대상으로 추가할 수
// 있어야 한다(인증된 스트리머로 제한하지 않음).
const addPromotedStreamer = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
  const adminName = request.auth.token.name || request.auth.token.email;
  const nickname = ((request.data && request.data.nickname) || '').trim();
  if (!nickname) throw new HttpsError('invalid-argument', '스트리머 이름을 입력해 주세요.');
  if (nickname.length > PROMOTED_STREAMER_NAME_MAX) {
    throw new HttpsError('invalid-argument', '스트리머 이름은 ' + PROMOTED_STREAMER_NAME_MAX + '자 이하로 입력해 주세요.');
  }

  const listRef = getDatabase().ref('bettingMarket/promotedStreamers');
  const existingSnap = await listRef.get();
  const existing = existingSnap.val() || {};
  const alreadyAdded = Object.keys(existing).some((key) => existing[key].nickname === nickname);
  if (alreadyAdded) throw new HttpsError('failed-precondition', '이미 추가된 스트리머입니다.');

  const ref = listRef.push();
  await ref.set({ nickname, addedAt: Date.now(), addedBy: adminUid });
  await logAudit(adminUid, adminName, '게시글 홍보 현황 추가', nickname);
  return { id: ref.key };
});

const removePromotedStreamer = onCall(async (request) => {
  const adminUid = await requireAdmin(request);
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
