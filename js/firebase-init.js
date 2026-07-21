import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
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
  query, orderByChild, equalTo, limitToFirst,
  httpsCallable: (name) => httpsCallable(functions, name),
  GoogleAuthProvider,
};
window.sbmAuth = auth;
window.sbmDb = db;
window.sbmUser = null;      // 익명 계정 포함, 현재 인증 세션 (마켓 등 공개 데이터 읽기 권한용)
window.sbmRealUser = null;  // 익명이 아닌 실제(Google) 로그인 계정만 — "로그인 여부" UI 판단은 항상 이걸로
// 07번 — 관리자 판별: Firebase Auth 이메일이 skftodwocks2@gmail.com인 계정
window.sbmIsAdmin = false;

function signIn() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider).catch((err) => {
    console.error('Google 로그인 실패', err);
  });
}
window.sbmSignIn = signIn;
window.sbmSignOut = () => signOut(auth);

window.sbmIsVerifiedStreamer = false;

// 페이지 접속 시(로딩화면 동안) 자동으로 익명 로그인 — auth != null 규칙을 만족시켜
// 로그인 전에도 마켓 목록 등 공개 데이터를 읽을 수 있게 한다. 배팅·제안·환전 등
// 실계정이 필요한 기능은 Cloud Functions가 익명 계정을 별도로 거부한다(requireRealAccount).
onAuthStateChanged(auth, async (user) => {
  window.sbmUser = user;
  window.sbmRealUser = user && !user.isAnonymous ? user : null;
  window.sbmIsAdmin = !!window.sbmRealUser && window.sbmRealUser.email === 'skftodwocks2@gmail.com';
  window.sbmIsVerifiedStreamer = false;
  document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user, realUser: window.sbmRealUser } }));

  if (!user) {
    signInAnonymously(auth).catch((err) => console.error('익명 로그인 실패', err));
    return;
  }

  if (window.sbmRealUser) {
    try {
      const q = query(ref(db, 'streamerVerifications'), orderByChild('uid'), equalTo(user.uid), limitToFirst(1));
      const snap = await get(q);
      window.sbmIsVerifiedStreamer = snap.exists();
    } catch (e) {
      console.error('인증 스트리머 여부 확인 실패', e);
    }
    document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user, realUser: window.sbmRealUser } }));
  }
});

// 07번 — Ctrl+Enter 단축키로 어디서든 Google 로그인 팝업 (게스트/익명 상태에서도 실계정 전환 가능)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && !window.sbmRealUser) {
    e.preventDefault();
    signIn();
  }
});
