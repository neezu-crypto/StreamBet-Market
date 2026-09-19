const crypto = require('crypto');

// 공개 화면에는 Firebase Auth UID를 절대 싣지 않는다. 공개 레코드와 내부 UID를
// 연결해야 하는 서버 작업은 이 매핑을 통해서만 처리한다. 매핑 노드는 RTDB 규칙에서
// 클라이언트 읽기/쓰기를 모두 차단한다.
const PUBLIC_ID_BYTES = 9;

function publicIdFor(app, uid) {
  const digest = crypto.createHash('sha256').update(`${app}:${uid}`).digest('base64url');
  return `${app.slice(0, 3).toUpperCase()}-${digest.slice(0, 12)}`;
}

async function ensurePublicId(db, app, uid) {
  if (!uid) throw new Error('uid is required');
  const uidRef = db.ref(`privateUserIds/${app}/byUid/${uid}`);
  const existing = await uidRef.get();
  if (existing.exists() && existing.val()) return existing.val();

  // 해시 기반 ID지만 앱 네임스페이스를 포함하므로 자매 앱 간 동일 UID를 바로
  // 대조할 수 없고, 이후 랜덤 ID로 교체할 때도 이 함수 호출부만 바꾸면 된다.
  // 기존 매핑이 동시에 만들어져도 동일 값으로 수렴한다.
  const id = publicIdFor(app, uid);
  await db.ref().update({
    [`privateUserIds/${app}/byUid/${uid}`]: id,
    [`privateUserIds/${app}/byPublicId/${id}`]: uid,
  });
  return id;
}

function publicVerificationRecord(record) {
  return {
    nickname: record.nickname || '',
    soopId: record.soopId || null,
    verifiedAt: record.verifiedAt || null,
  };
}

async function syncPublicVerification(db, recordId, record) {
  if (!recordId || !record) return;
  await db.ref(`streamerVerificationsPublic/${recordId}`).set(publicVerificationRecord(record));
}

async function removePublicVerification(db, recordId) {
  if (!recordId) return;
  await db.ref(`streamerVerificationsPublic/${recordId}`).remove();
}

module.exports = {
  ensurePublicId,
  publicIdFor,
  syncPublicVerification,
  removePublicVerification,
};
