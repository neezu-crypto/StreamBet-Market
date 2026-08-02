const { HttpsError } = require('firebase-functions/v2/https');
const { getDatabase } = require('firebase-admin/database');
const { ADMIN_EMAIL } = require('../constants');

// uid 위변조 검증 원칙 (11번) — 대상 uid는 항상 request.auth.uid에서만 가져온다.
function requireAuth(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }
  return request.auth.uid;
}

// 09번 마이그레이션 — 관리자 판별을 이메일 문자열 비교에서 공유
// adminCenter/adminUids uid 조회로 옮긴다. 아직 uid가 등록 안 된 경우에만
// 기존 이메일 비교로 폴백하고, 폴백이 쓰이면 로그를 남겨 이후 완전히
// 제거해도 안전한 시점을 판단한다(admin-center와 동일한 전환 방식).
async function isAdminUid(uid) {
  const db = getDatabase();
  const snap = await db.ref('adminCenter/adminUids/' + uid).get();
  return snap.val() === true;
}

function isAdminEmail(email) {
  return !!email && email === ADMIN_EMAIL;
}

// uid 우선, 이메일 폴백. 새 코드는 가능하면 isAdminEmail 대신 이 함수를 쓸 것.
async function isAdmin(uid, email) {
  if (await isAdminUid(uid)) return true;
  if (isAdminEmail(email)) {
    console.warn('관리자 판별 이메일 폴백 사용됨(uid 미등록):', uid);
    return true;
  }
  return false;
}

// 페이지 접속 시 자동으로 생성되는 익명 계정은 마켓 등 공개 데이터를 읽을 수 있게 하기 위한 것으로,
// 재화가 걸린 기능(배팅, 제안, 환전, 출석보상, 신고 등)은 실제(비익명) 계정만 사용할 수 있다.
// 그렇지 않으면 익명 계정을 계속 새로 발급받아 09번이 막으려는 "즉석 다중 계정" 어뷰징이 그대로 재현된다.
function requireRealAccount(request) {
  const uid = requireAuth(request);
  const provider = request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
  if (provider === 'anonymous') {
    throw new HttpsError('permission-denied', '게스트(익명) 계정은 이 기능을 사용할 수 없습니다. Google 로그인 후 다시 시도해 주세요.');
  }
  return uid;
}

// 익명 계정도 대부분 기능을 그대로 쓸 수 있게 됐지만(어뷰징 시 우회가 쉬운 만큼 대기시간·쿨다운은
// 익명에게 그대로 적용), 실계정(비익명)으로 로그인한 유저는 대기시간·쿨다운성 제한에서는 면제한다.
// 한도액(1회 최대 배팅, 일별 환전 한도 등)은 실계정이어도 그대로 유지한다.
function isRealAccount(request) {
  const provider = request.auth && request.auth.token && request.auth.token.firebase && request.auth.token.firebase.sign_in_provider;
  return provider !== 'anonymous';
}

async function requireAdmin(request) {
  const uid = requireAuth(request);
  const email = request.auth.token && request.auth.token.email;
  if (!(await isAdmin(uid, email))) {
    throw new HttpsError('permission-denied', '관리자만 수행할 수 있습니다.');
  }
  return uid;
}

// 05번 — 인증 스트리머 여부는 공유 streamerVerifications 노드의 uid 필드로 판별한다.
async function isVerifiedStreamerUid(uid) {
  const db = getDatabase();
  const snap = await db
    .ref('streamerVerifications')
    .orderByChild('uid')
    .equalTo(uid)
    .limitToFirst(1)
    .get();
  return snap.exists();
}

// 10번 — 판정/검증 권한은 관리자 또는 인증 스트리머만 가능. 정지된 계정은 admin/인증
// 스트리머라도 이 권한을 쓸 수 없어야 하므로 여기서 항상 확인한다.
async function requireAdminOrVerifiedStreamer(request) {
  const uid = requireAuth(request);
  await assertNotBanned(uid);
  const email = request.auth.token && request.auth.token.email;
  if (await isAdmin(uid, email)) return { uid, role: 'admin' };
  if (await isVerifiedStreamerUid(uid)) return { uid, role: 'streamer' };
  throw new HttpsError('permission-denied', '관리자 또는 인증 스트리머만 수행할 수 있습니다.');
}

// 스트리머 인증 제도의 목적 — 스트리머는 로그인(구글/카카오 계정 연동)을 꺼리는 경우가 많아,
// 관리자 검수만 통과하면 로그인 없이(익명 세션이어도) 실계정 로그인 유저와 완전히 동일하게
// 대기시간·쿨다운 면제는 물론 환전까지 포함한 모든 기능을 그대로 쓸 수 있어야 한다.
// 한도액(1회 최대 배팅, 환전 일별 한도 등)은 실계정과 동일하게 그대로 적용된다.
async function isTrustedAccount(request) {
  if (isRealAccount(request)) return true;
  const email = request.auth.token && request.auth.token.email;
  if (await isAdmin(request.auth.uid, email)) return true;
  return isVerifiedStreamerUid(request.auth.uid);
}

// 관리 탭 — 계정 정지. 재화가 걸린 모든 액션 함수 진입부에서 호출해 정지된 uid를 차단한다.
// 20번 2단계 — soop-stock-market과 공유하는 uid 기준 원장(bannedAccounts/{uid})을
// 본다(예전엔 bettingMarket/bannedAccounts 전용이었지만, 04번에서 배운 대로
// 저장소마다 따로 정지 노드를 두지 않고 하나로 합쳤다). 정지는 기본이 게임별이라
// all이 없으면 games.bettingMarket만 확인한다 - 주식시장에서만 정지된 계정은
// 여기서 막히지 않는다(관리자가 통합 관리 센터에서 "전체 게임 정지"를 선택했을
// 때만 all:true로 걸림).
async function assertNotBanned(uid) {
  const db = getDatabase();
  const snap = await db.ref('bannedAccounts/' + uid).get();
  if (!snap.exists()) return;
  const ban = snap.val();
  if (ban.all) {
    throw new HttpsError('permission-denied', '정지된 계정입니다' + (ban.allReason ? ' (사유: ' + ban.allReason + ')' : '') + '.');
  }
  if (ban.games && ban.games.bettingMarket) {
    throw new HttpsError('permission-denied', '정지된 계정입니다' + (ban.games.bettingMarket.reason ? ' (사유: ' + ban.games.bettingMarket.reason + ')' : '') + '.');
  }
}

module.exports = {
  requireAuth,
  requireRealAccount,
  isRealAccount,
  isTrustedAccount,
  isAdminUid,
  isAdminEmail,
  isAdmin,
  requireAdmin,
  isVerifiedStreamerUid,
  requireAdminOrVerifiedStreamer,
  assertNotBanned,
};
