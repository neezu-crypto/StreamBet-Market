// 16번 — 겨울(스노우) 테마 배경. CodePen "Winter Trees"(CJ Gammon, MIT,
// https://codepen.io/cjgammon/pen/ONWeZX)의 "저폴리 원뿔을 여러 겹 쌓아 나무를
// 만드는" 절차적 생성 방식을 겨울 팔레트(흰색·연한 하늘색)로 다시 칠해 가져왔다.
// 원본은 오래된 THREE.js 전역 빌드 + OrbitControls·EffectComposer 애드온 +
// 지금은 죽은 외부 텍스처(CORS 프록시)에 의존해서 그대로 포팅할 수 없었고,
// 이 프로젝트엔 3D 라이브러리가 전혀 없어서 최신 three.js를 CDN(importmap)으로
// 새로 불러와 텍스처 없이 순수 절차적 지오메트리로 재구성했다. 마우스 조작
// (OrbitControls) 대신 카메라가 씬 중심을 천천히 자동으로 도는 것으로 바꿨다.
import * as THREE from 'three';

var scene = null;
var camera = null;
var renderer = null;
var canvas = null;
var rafId = null;
var clock = null;
var angle = 0;
var reducedMotion = false;

var ORBIT_RADIUS = 950;
var ORBIT_HEIGHT = 260;
var ORBIT_SPEED = 0.045; // 라디안/초 — 1바퀴 도는 데 약 140초, 눈에 거슬리지 않는 자연스러운 속도

function isReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function makeTree() {
  var group = new THREE.Group();

  var trunkGeo = new THREE.CylinderGeometry(6, 8, 60, 6, 1);
  var trunkMat = new THREE.MeshPhongMaterial({ color: 0x5b4a3f, flatShading: true });
  var trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = -20;
  group.add(trunk);

  // 아래(그늘진 연한 하늘색) → 위(눈 덮인 흰색)로 층마다 색을 보간한다
  var shadowColor = new THREE.Color(0xbcd9ec);
  var snowColor = new THREE.Color(0xffffff);
  var layers = 5 + Math.round(Math.random());

  for (var i = 0; i < layers; i++) {
    var t = layers > 1 ? i / (layers - 1) : 1;
    var color = shadowColor.clone().lerp(snowColor, t);
    var radiusTop = i * 4;
    var radiusBottom = 28 + i * 7;
    var geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, 46, 6, 1);
    var mat = new THREE.MeshPhongMaterial({ color: color, flatShading: true });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 55 - i * 20;
    var rot = i > 0 ? (Math.random() - 0.5) * 0.08 : 0;
    mesh.rotation.set(rot, 0, rot);
    group.add(mesh);
  }

  return group;
}

function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xdcedf7, 700, 2600);
  scene.background = new THREE.Color(0xeaf4fb);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 5000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene.add(new THREE.AmbientLight(0xe4edf5, 1.0));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.55);
  dirLight.position.set(400, 700, 300);
  scene.add(dirLight);

  var groundGeo = new THREE.PlaneGeometry(5000, 5000);
  var groundMat = new THREE.MeshPhongMaterial({ color: 0xf4f9fc, flatShading: true });
  var ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -30;
  scene.add(ground);

  var count = 150;
  for (var i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    var r = 220 + Math.random() * 1550;
    var tree = makeTree();
    tree.position.set(Math.cos(a) * r, -30, Math.sin(a) * r);
    var s = 0.6 + Math.random() * 0.9;
    tree.scale.set(s, s, s);
    scene.add(tree);
  }
}

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function renderFrame() {
  camera.position.set(Math.cos(angle) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.sin(angle) * ORBIT_RADIUS);
  camera.lookAt(0, 80, 0);
  renderer.render(scene, camera);
}

function animate() {
  rafId = requestAnimationFrame(animate);
  angle += ORBIT_SPEED * clock.getDelta();
  renderFrame();
}

function show() {
  if (canvas) return; // 이미 떠 있음
  try {
    reducedMotion = isReducedMotion();
    buildScene();
  } catch (e) {
    scene = camera = renderer = null;
    return; // WebGL 미지원 등 — CSS 단색 배경(--ink)으로 폴백
  }
  canvas = renderer.domElement;
  canvas.id = 'sbm-winter-scene-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  renderFrame(); // 첫 프레임(정적 상태에서도 최소 한 번은 보이게)
  window.addEventListener('resize', onResize);

  if (!reducedMotion) {
    clock = new THREE.Clock();
    rafId = requestAnimationFrame(animate);
  }
}

function hide() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  window.removeEventListener('resize', onResize);
  if (renderer) { renderer.dispose(); }
  if (canvas) { canvas.remove(); }
  scene = camera = renderer = canvas = clock = null;
  angle = 0;
}

function syncFromHtmlClass() {
  var isWinter = document.documentElement.classList.contains('theme-winter-snow');
  if (isWinter) show(); else hide();
}

// js/skins.js(스킨 적용 로직)가 html에 theme-* 클래스를 갈아끼우는 방식이라,
// 별도로 함수를 호출해주지 않아도 되도록 class 변화를 직접 관찰한다 — 모듈
// 스크립트 로드 시점과 skins.js 실행 순서에 의존하지 않아 더 안전하다.
new MutationObserver(syncFromHtmlClass).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});
syncFromHtmlClass(); // 이미 겨울 테마로 로드된 상태(예: 새로고침)도 반영
