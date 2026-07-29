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

// 처음엔 THREE.ShaderMaterial을 처음부터 새로 짜서 썼는데(정점+프래그먼트
// 셰이더 직접 작성), 프래그먼트 쪽 smoothstep 인자 순서 버그로 전체가 투명
// 렌더링되는 문제가 있었다. 그걸 고친 뒤에도 검증이 어려워서(이 환경에서 직접
// 브라우저로 셰이더를 못 띄워봄), 이미 검증된 더 안전한 방식으로 바꿨다 —
// 검증된 THREE.MeshBasicMaterial(색상·투명도·렌더링 전부 기본 파이프라인이
// 알아서 처리) 위에 onBeforeCompile로 정점 변위(바람 물결)만 주입한다. 겨울
// 테마 나무 림 라이트(js/winter-scene.js applyRimLight)에서 이미 검증한 것과
// 동일한 기법 — three.js 공식 소스(meshbasic.glsl.js)로 청크 순서를 확인한 뒤
// #include <begin_vertex>(transformed = position 초기화) 직후에 끼워 넣는다.
function applyWindWave(material, uniforms) {
  material.onBeforeCompile = function (shader) {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSeed = uniforms.uSeed;
    shader.uniforms.uWidth = uniforms.uWidth;
    shader.uniforms.uGust = uniforms.uGust;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      'uniform float uTime;\nuniform float uSeed;\nuniform float uWidth;\nuniform float uGust;\n#include <common>'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n' +
      '{\n' +
      '  float tkT = clamp(transformed.x / uWidth, 0.0, 1.0);\n' + // geo.translate로 로컬 x가 [0, uWidth] 범위라 0=깃대, 1=깃발 끝
      '  float tkDamp = tkT * tkT;\n' +
      '  float tkWave = sin(transformed.y * 0.05 + uTime * 2.6 + uSeed) * 26.0 * tkDamp * uGust;\n' +
      '  tkWave += sin(transformed.y * 0.13 - uTime * 4.1 + uSeed * 1.7) * 10.0 * tkDamp * uGust;\n' +
      '  transformed.z += tkWave;\n' +
      '  transformed.x += sin(transformed.y * 0.08 + uTime * 2.0 + uSeed) * 6.0 * tkDamp * uGust;\n' +
      '}\n'
    );
  };
  material.customProgramCacheKey = function () { return 'tkFlagWind'; };
}

function makeFlag(def) {
  var geo = new THREE.PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, 28, 16);
  var mat = new THREE.MeshBasicMaterial({ color: def.color, side: THREE.DoubleSide });
  var uniforms = {
    uTime: { value: 0 },
    uSeed: { value: def.seed },
    uWidth: { value: FLAG_WIDTH },
    uGust: { value: 1 }
  };
  applyWindWave(mat, uniforms);

  var mesh = new THREE.Mesh(geo, mat);
  // 평면의 왼쪽 끝(x=-FLAG_WIDTH/2)이 깃대에 붙는 지점이 되도록, 오브젝트
  // 자체를 오른쪽으로 절반만큼 옮겨서 origin(깃대 위치)이 곧 mesh.position이 되게 한다.
  mesh.position.set(def.x, FLAG_HEIGHT * 0.32, -80);
  geo.translate(FLAG_WIDTH * 0.5, 0, 0);

  var poleGeo = new THREE.CylinderGeometry(4, 5, FLAG_HEIGHT * 1.35, 8);
  var poleMat = new THREE.MeshBasicMaterial({ color: 0x3a2513 });
  var pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(def.x, 0, -80);

  return { mesh: mesh, pole: pole, mat: mat, uniforms: uniforms };
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
  flags.forEach(function (f) {
    f.uniforms.uTime.value = t;
    f.uniforms.uGust.value = Math.max(0.4, gust);
  });
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
    flags.forEach(function (f) { f.uniforms.uGust.value = 0; });
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
