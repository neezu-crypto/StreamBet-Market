// SOOP 아이디로부터 프로필 이미지 URL을 계산한다. profile.js(updateProfile)와
// verification.js(인증 승인 시 프로필 자동 채움)가 동일한 규칙을 공유해야 하므로 여기 둔다.
function avatarUrlFor(soopId) {
  if (!soopId) return '';
  const folder = soopId.slice(0, 2);
  return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
}

module.exports = { avatarUrlFor };
