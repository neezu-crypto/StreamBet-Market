const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { requireAuth } = require('./lib/auth');
const { NICKNAME_CHANGE_COOLDOWN_MS, NICKNAME_MAX_LENGTH } = require('./constants');

function avatarUrlFor(soopId) {
  if (!soopId) return '';
  const folder = soopId.slice(0, 2);
  return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
}

// 13번 — 닉네임(1일 1회 제한) · SOOP 아이디 → 프로필 이미지 자동 설정
const updateProfile = onCall(async (request) => {
  const uid = requireAuth(request);
  const { nickname, soopId } = request.data || {};
  const name = (nickname || '').trim();
  if (!name || name.length > NICKNAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', '닉네임은 1자 이상 ' + NICKNAME_MAX_LENGTH + '자 이하로 입력해 주세요.');
  }

  const ref = getDatabase().ref('bettingMarket/profiles/' + uid);
  const snap = await ref.get();
  const current = snap.val() || {};
  const nameChanged = current.nickname !== name;

  if (nameChanged && current.nicknameChangedAt) {
    const remaining = NICKNAME_CHANGE_COOLDOWN_MS - (Date.now() - current.nicknameChangedAt);
    if (remaining > 0) {
      throw new HttpsError('failed-precondition', '닉네임은 하루 1회만 변경할 수 있습니다.');
    }
  }

  const id = (soopId || '').trim();
  const update = {
    nickname: name,
    soopId: id,
    avatarUrl: avatarUrlFor(id),
  };
  if (nameChanged) update.nicknameChangedAt = Date.now();
  await ref.update(update);
  return update;
});

module.exports = { updateProfile };
