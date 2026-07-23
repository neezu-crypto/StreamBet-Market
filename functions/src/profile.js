const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth, isTrustedAccount, assertNotBanned } = require('./lib/auth');
const { avatarUrlFor } = require('./lib/avatar');
const { NICKNAME_CHANGE_COOLDOWN_MS, NICKNAME_MAX_LENGTH, NICKNAME_FORBIDDEN_RE, SOOP_ID_RE } = require('./constants');

// 13번 — 닉네임(1일 1회 제한) · SOOP 아이디 → 프로필 이미지 자동 설정
const updateProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const { nickname, soopId } = request.data || {};
  const name = (nickname || '').trim();
  if (!name || name.length > NICKNAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', '닉네임은 1자 이상 ' + NICKNAME_MAX_LENGTH + '자 이하로 입력해 주세요.');
  }
  if (NICKNAME_FORBIDDEN_RE.test(name)) {
    throw new HttpsError('invalid-argument', '닉네임에 사용할 수 없는 문자가 포함되어 있습니다.');
  }
  const rawSoopId = (soopId || '').trim();
  if (rawSoopId && !SOOP_ID_RE.test(rawSoopId)) {
    throw new HttpsError('invalid-argument', 'SOOP 아이디는 영문 소문자/숫자 2~20자여야 합니다.');
  }

  const db = getDatabase();
  const ref = db.ref('bettingMarket/profiles/' + uid);
  const snap = await ref.get();
  const current = snap.val() || {};
  const nameChanged = current.nickname !== name;

  // 닉네임 차단(blockNickname)으로 강제 초기화된 계정은, 본인이 마음대로 새 닉네임을
  // 골라 차단 직전의(또는 또 다른 부적절한) 닉네임으로 즉시 되돌리지 못하게 막는다.
  // 관리자가 unblockNickname으로 명시적으로 해제해야만 다시 닉네임을 바꿀 수 있다.
  if (nameChanged) {
    const blockedSnap = await db.ref('bettingMarket/blockedNicknames/' + uid).get();
    if (blockedSnap.exists()) {
      throw new HttpsError('permission-denied', '닉네임이 신고로 차단된 계정입니다. 관리자의 차단 해제 후 다시 시도해 주세요.');
    }
  }

  if (nameChanged && current.nicknameChangedAt && !(await isTrustedAccount(request))) {
    const remaining = NICKNAME_CHANGE_COOLDOWN_MS - (Date.now() - current.nicknameChangedAt);
    if (remaining > 0) {
      throw new HttpsError('failed-precondition', '닉네임은 하루 1회만 변경할 수 있습니다.');
    }
  }

  const update = {
    nickname: name,
    soopId: rawSoopId,
    avatarUrl: avatarUrlFor(rawSoopId),
  };
  if (nameChanged) {
    update.nicknameChangedAt = Date.now();
    // 닉네임 차단으로 강제 초기화된 뒤 본인이 새 닉네임을 정하면, 안내 배너를 끄기 위해 지운다.
    update.nicknameResetReason = null;
    update.nicknameResetAt = null;
  }
  await ref.update(update);

  // 13번 — 랭킹에 표시되는 닉네임·아바타가 바뀌므로 이 시점에만 랭킹 재계산
  const { recomputeRankingsAfter } = require('./rankings');
  await recomputeRankingsAfter('updateProfile');

  return update;
});

module.exports = { updateProfile };
