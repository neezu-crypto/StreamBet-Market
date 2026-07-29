// 16번 — 삼국지 전장 테마의 3D 깃발 배경. winter-scene.js/firework-scene.js와
// 동일한 패턴(ES 모듈, MutationObserver로 theme-three-kingdoms 클래스를 직접
// 관찰, importmap으로 공유하는 three.js)으로 만든다.
//
// "바람 물리"는 진짜 천 시뮬레이션(버텍릿 적분 등) 대신, 깃발 실무에서 흔히
// 쓰는 정점 셰이더 기법을 쓴다 — 평면 메시를 가로로 잘게 쪼개고(세그먼트多),
// 깃대에 붙은 쪽(x=0)은 거의 안 움직이게, 먼 쪽(x=1)일수록 크게 출렁이게
// 감쇠 계수(t*t)를 곱한 사인파를 z축으로 밀어낸다. 실제 깃발이 깃대 쪽은
// 고정되고 끝으로 갈수록 펄럭임이 커지는 물리와 같은 모양을 낸다. 여기에
// 느린 주기의 "돌풍" 포락선을 곱해 일정한 흔들림이 아니라 바람이 세졌다
// 약해졌다 하는 느낌을 더한다.
import * as THREE from 'three';

var scene = null, camera = null, renderer = null, canvas = null;
var clock = null;
var rafId = null;
var flags = [];
var reducedMotion = false;

function isReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 깃발 3종 — 위(파랑) · 촉(초록) · 오(빨강), 화면을 거의 채울 만큼 크게 넓은
// 간격으로 배치한다.
var FLAG_DEFS = [
  { name: 'wei', color: new THREE.Color(0x2f6fb0), x: -300, seed: 0.0 },
  { name: 'shu', color: new THREE.Color(0x3e8f52), x: 0, seed: 2.1 },
  { name: 'wu', color: new THREE.Color(0xb23a2e), x: 300, seed: 4.3 },
];
var FLAG_WIDTH = 230;
var FLAG_HEIGHT = 340;

// 커스텀 ShaderMaterial(정점+프래그먼트 직접 작성)과 MeshBasicMaterial+
// onBeforeCompile 셰이더 주입 두 가지 방식을 다 시도했는데 둘 다 실제
// 브라우저에서 깃발 천만 투명하게(또는 아예 안 보이게) 나왔다 — 콘솔에 에러도
// 안 남아서(셰이더 컴파일 자체는 됐다는 뜻) 원인을 못 좁혔다. 그래서 셰이더를
// 아예 안 쓰는, 이 프로젝트에서 이미 검증된 방식으로 바꿨다 — js/firework-scene.js가
// 수천 개 파티클 위치를 매 프레임 CPU에서 직접 계산해 geometry.attributes.position.array를
// 갱신하고 needsUpdate=true로 GPU에 반영하는 것과 완전히 같은 패턴. 정점이
// 450개 정도뿐이라 CPU 계산 비용도 무시할 수준이다.
function updateFlagWave(f, t, gust) {
  var arr = f.geo.attributes.position.array;
  var count = f.geo.attributes.position.count;
  for (var i = 0; i < count; i++) {
    var idx = i * 3;
    var x = arr[idx]; // geo.translate로 로컬 x가 [0, FLAG_WIDTH] 범위 — 0=깃대, FLAG_WIDTH=깃발 끝
    var y = arr[idx + 1];
    var tT = Math.min(1, Math.max(0, x / FLAG_WIDTH));
    var damp = tT * tT; // 깃대 쪽은 거의 안 움직이고 먼 쪽일수록 크게 출렁이는 감쇠
    var wave = Math.sin(y * 0.05 + t * 2.6 + f.seed) * 26 * damp * gust;
    wave += Math.sin(y * 0.13 - t * 4.1 + f.seed * 1.7) * 10 * damp * gust;
    arr[idx + 2] = wave;
  }
  f.geo.attributes.position.needsUpdate = true;
}

function makeFlag(def) {
  var geo = new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, 28, 16);
  var mat = new THREE.MeshBasicMaterial({ color: def.color, side: THREE.DoubleSide });
  var mesh = new THREE.Mesh(geo, mat);
  // 평면의 왼쪽 끝(x=-FLAG_WIDTH/2)이 깃대에 붙는 지점이 되도록, 오브젝트
  // 자체를 오른쪽으로 절반만큼 옮겨서 origin(깃대 위치)이 곧 mesh.position이 되게 한다.
  mesh.position.set(def.x, FLAG_HEIGHT * 0.32, -80);
  geo.translate(FLAG_WIDTH * 0.5, 0, 0);

  var poleGeo = new THREE.CylinderGeometry(4, 5, FLAG_HEIGHT * 1.35, 8);
  var poleMat = new THREE.MeshBasicMaterial({ color: 0x3a2513 });
  var pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(def.x, 0, -80);

  return { mesh: mesh, pole: pole, mat: mat, geo: geo, seed: def.seed };
}

function buildScene() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 3000);
  camera.position.set(0, 40, 520);
  camera.lookAt(0, 20, -80);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);

  flags = FLAG_DEFS.map(function (def) {
    var f = makeFlag(def);
    scene.add(f.mesh);
    scene.add(f.pole);
    return f;
  });
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  rafId = requestAnimationFrame(animate);
  var t = clock.getElapsedTime();
  // 느린 주기의 "돌풍" 포락선(0.6~1.15배) — 바람 세기가 계속 바뀌는 느낌
  var gust = 0.85 + 0.3 * Math.sin(t * 0.35) + 0.15 * Math.sin(t * 0.9 + 1.3);
  var clampedGust = Math.max(0.4, gust);
  flags.forEach(function (f) { updateFlagWave(f, t, clampedGust); });
  renderer.render(scene, camera);
}

function show() {
  if (canvas) return;
  try {
    reducedMotion = isReducedMotion();
    buildScene();
  } catch (e) {
    scene = camera = renderer = null;
    return;
  }
  canvas = renderer.domElement;
  canvas.id = 'sbm-three-kingdoms-scene-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  window.addEventListener('resize', onResize);

  if (reducedMotion) {
    flags.forEach(function (f) { updateFlagWave(f, 0, 0); });
    renderer.render(scene, camera);
    return;
  }
  clock = new THREE.Clock();
  rafId = requestAnimationFrame(animate);
}

function hide() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  window.removeEventListener('resize', onResize);
  flags.forEach(function (f) {
    if (f.mesh) { f.mesh.geometry.dispose(); f.mesh.material.dispose(); }
    if (f.pole) { f.pole.geometry.dispose(); f.pole.material.dispose(); }
  });
  flags = [];
  if (renderer) renderer.dispose();
  if (canvas) canvas.remove();
  scene = camera = renderer = canvas = clock = null;
}

function syncFromHtmlClass() {
  var isActive = document.documentElement.classList.contains('theme-three-kingdoms');
  if (isActive) show(); else hide();
}
new MutationObserver(syncFromHtmlClass).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});
syncFromHtmlClass();
