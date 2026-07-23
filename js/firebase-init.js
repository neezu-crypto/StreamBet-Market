import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  remove,
  onValue,
  runTransaction,
  serverTimestamp,
  query,
  orderByChild,
  equalTo,
  limitToFirst,
  limitToLast,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';
import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js';

// 07번 — 배팅시장 전용 Web App 등록 (같은 프로젝트 soop-stock-market, appId만 별개)
const firebaseConfig = {
  apiKey: 'AIzaSyAZcjQPHphENs-Bb7IfdL2qTtOMhJrRP54',
  authDomain: 'soop-stock-market.firebaseapp.com',
  databaseURL: 'https://soop-stock-market-default-rtdb.firebaseio.com',
  projectId: 'soop-stock-market',
  storageBucket: 'soop-stock-market.firebasestorage.app',
  messagingSenderId: '997788925900',
  appId: '1:997788925900:web:cdddfe20075aa199a3a769',
  measurementId: 'G-S34C3VXKBQ',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app);

window.sbmFirebase = {
  ref, get, set, update, push, remove, onValue, runTransaction, serverTimestamp,
  query, orderByChild, equalTo, limitToFirst, limitToLast,
  httpsCallable: (name) => httpsCallable(functions, name),
  GoogleAuthProvider,
};
window.sbmAuth = auth;
window.sbmDb = db;
window.sbmUser = null;      // 익명 계정 포함, 현재 인증 세션 (마켓 등 공개 데이터 읽기 권한용)
window.sbmRealUser = null;  // 익명이 아닌 실제(Google) 로그인 계정만. 익명 세션의 인증 스트리머는
                             // 여기 안 잡히므로, "로그인한 것처럼 대우" 판단은 sbmTrusted를 쓴다.
// 07번 — 관리자 판별: Firebase Auth 이메일이 skftodwocks2@gmail.com인 계정
window.sbmIsAdmin = false;

function signIn() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider).catch((err) => {
    console.error('Google 로그인 실패', err);
    // 사용자가 스스로 팝업을 닫거나 중복 요청을 취소한 경우는 실패가 아니라 조용히 무시한다.
    if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) return;
    alert('Google 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  });
}
window.sbmSignIn = signIn;
window.sbmSignOut = () => signOut(auth);
// 주식시장과 동일 프로젝트를 공유하는 linkKakaoAccount Function이 돌려주는
// 커스텀 토큰으로 전환할 때 쓴다 (js/kakao-login.js).
window.sbmSignInWithCustomToken = (token) => signInWithCustomToken(auth, token);

window.sbmIsVerifiedStreamer = false;
// 실계정으로 로그인했거나, 관리자거나, 인증 스트리머(익명 세션이어도)면 true.
// 스트리머 인증 제도의 목적 자체가 "로그인을 꺼리는 스트리머도 검수만 통과하면
// 로그인 유저와 완전히 동일하게 쓸 수 있게" 하는 것이므로, 화면 전반의 "로그인 여부"
// UI 판단은 sbmRealUser 대신 이걸로 해야 한다.
window.sbmTrusted = false;

function sbmUpdateTrusted() {
  window.sbmTrusted = !!(window.sbmRealUser || window.sbmIsAdmin || window.sbmIsVerifiedStreamer);
}

// 페이지 접속 시(로딩화면 동안) 자동으로 익명 로그인 — auth != null 규칙을 만족시켜
// 로그인 전에도 마켓 목록 등 공개 데이터를 읽을 수 있게 한다. 배팅·제안·환전 등은 이제
// 익명 세션도 대부분 쓸 수 있지만(어뷰징 위험이 큰 환전만 예외), 인증 스트리머 여부는
// 익명 세션이어도 반드시 확인해야 한다 — 로그인을 꺼리는 스트리머가 인증만 받으면
// 로그인 없이도 실계정과 동일하게 쓸 수 있어야 하기 때문.
onAuthStateChanged(auth, async (user) => {
  window.sbmUser = user;
  window.sbmRealUser = user && !user.isAnonymous ? user : null;
  window.sbmIsAdmin = !!window.sbmRealUser && window.sbmRealUser.email === 'skftodwocks2@gmail.com';
  window.sbmIsVerifiedStreamer = false;
  sbmUpdateTrusted();
  document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user, realUser: window.sbmRealUser, trusted: window.sbmTrusted } }));

  if (!user) {
    signInAnonymously(auth).catch((err) => console.error('익명 로그인 실패', err));
    return;
  }

  try {
    const q = query(ref(db, 'streamerVerifications'), orderByChild('uid'), equalTo(user.uid), limitToFirst(1));
    const snap = await get(q);
    window.sbmIsVerifiedStreamer = snap.exists();
  } catch (e) {
    console.error('인증 스트리머 여부 확인 실패', e);
  }
  sbmUpdateTrusted();
  document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user, realUser: window.sbmRealUser, trusted: window.sbmTrusted } }));
});

// 07번 — Ctrl+Enter 단축키로 어디서든 Google 로그인 팝업 (게스트/익명 상태에서도 실계정 전환 가능)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && !window.sbmRealUser) {
    e.preventDefault();
    signIn();
  }
});
