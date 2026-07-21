import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
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
window.sbmUser = null;
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

// 05번 — 인증 스트리머 여부는 공유 streamerVerifications 노드의 uid 필드로 판별 (클라이언트는 UI 표시용, 실제 권한 검증은 Functions가 다시 확인)
onAuthStateChanged(auth, async (user) => {
  window.sbmUser = user;
  window.sbmIsAdmin = !!user && user.email === 'skftodwocks2@gmail.com';
  window.sbmIsVerifiedStreamer = false;
  document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user } }));

  if (user) {
    try {
      const q = query(ref(db, 'streamerVerifications'), orderByChild('uid'), equalTo(user.uid), limitToFirst(1));
      const snap = await get(q);
      window.sbmIsVerifiedStreamer = snap.exists();
    } catch (e) {
      console.error('인증 스트리머 여부 확인 실패', e);
    }
    document.dispatchEvent(new CustomEvent('sbm-auth-changed', { detail: { user } }));
  }
});

// 07번 — Ctrl+Enter 단축키로 어디서든 Google 로그인 팝업
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 'Enter' && !window.sbmUser) {
    e.preventDefault();
    signIn();
  }
});
