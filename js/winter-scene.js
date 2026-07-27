// 16번 — 겨울(스노우) 테마 배경. CodePen "Winter Trees"(CJ Gammon, MIT,
// https://codepen.io/cjgammon/pen/ONWeZX)의 "저폴리 원뿔을 여러 겹 쌓아 나무를
// 만드는" 절차적 생성 방식을 겨울 팔레트(흰색·연한 하늘색)로 다시 칠해 가져왔다.
// 원본은 오래된 THREE.js 전역 빌드 + OrbitControls·EffectComposer 애드온 +
// 지금은 죽은 외부 텍스처(CORS 프록시)에 의존해서 그대로 포팅할 수 없었고,
// 이 프로젝트엔 3D 라이브러리가 전혀 없어서 최신 three.js를 CDN(importmap)으로
// 새로 불러와 텍스처 없이 순수 절차적 지오메트리로 재구성했다. 마우스 조작
// (OrbitControls) 대신 카메라가 씬 중심을 천천히 자동으로 도는 것으로 바꿨다.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

var scene = null;
var camera = null;
var renderer = null;
var composer = null;
var canvas = null;
var rafId = null;
var clock = null;
var angle = 0;
var reducedMotion = false;
var sparkleMat = null; // 반짝이는 눈 파티클 셰이더(u_time 매 프레임 갱신용)
var elapsed = 0;

// 원본 CodePen의 "미니어처 디오라마" 느낌(수평·수직 틸트시프트 블러 + 블룸)을
// 내는 두 셰이더 — 지금의 three.js 애드온 모음엔 더 이상 번들되어 있지 않아서
// 원본이 쓰던 것과 동일한 9-tap 가우시안 틸트시프트 셰이더를 직접 옮겨왔다.
var TiltShiftShader = {
  uniforms: { tDiffuse: { value: null }, h: { value: 1 / 512 }, v: { value: 1 / 512 }, r: { value: 0.5 } },
  vertexShader:
    'varying vec2 vUv;' +
    'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShaderH:
    'uniform sampler2D tDiffuse; uniform float h; uniform float r; varying vec2 vUv;' +
    'void main() {' +
    '  vec4 sum = vec4(0.0);' +
    '  float hh = h * abs(r - vUv.y);' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x - 4.0*hh, vUv.y)) * 0.051;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x - 3.0*hh, vUv.y)) * 0.0918;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x - 2.0*hh, vUv.y)) * 0.12245;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x - 1.0*hh, vUv.y)) * 0.1531;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y)) * 0.1633;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x + 1.0*hh, vUv.y)) * 0.1531;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x + 2.0*hh, vUv.y)) * 0.12245;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x + 3.0*hh, vUv.y)) * 0.0918;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x + 4.0*hh, vUv.y)) * 0.051;' +
    '  gl_FragColor = sum;' +
    '}',
  fragmentShaderV:
    'uniform sampler2D tDiffuse; uniform float v; uniform float r; varying vec2 vUv;' +
    'void main() {' +
    '  vec4 sum = vec4(0.0);' +
    '  float vv = v * abs(r - vUv.y);' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 4.0*vv)) * 0.051;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 3.0*vv)) * 0.0918;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 2.0*vv)) * 0.12245;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y - 1.0*vv)) * 0.1531;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y)) * 0.1633;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 1.0*vv)) * 0.1531;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 2.0*vv)) * 0.12245;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 3.0*vv)) * 0.0918;' +
    '  sum += texture2D(tDiffuse, vec2(vUv.x, vUv.y + 4.0*vv)) * 0.051;' +
    '  gl_FragColor = sum;' +
    '}'
};

var ORBIT_RADIUS = 950;
var ORBIT_HEIGHT = 260;
var ORBIT_SPEED = 0.045; // 라디안/초 — 1바퀴 도는 데 약 140초, 눈에 거슬리지 않는 자연스러운 속도

function isReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// 태양 광원 위치 — 조명·해 스프라이트가 같은 방향을 향하도록 한 군데서 관리한다
var SUN_POS = { x: 900, y: 1000, z: 350 };

// 나무 테두리 림 라이트(rim light) — 태양 쪽을 향한 나무 실루엣 가장자리가
// 햇빛을 받아 반짝이는 것처럼 additive glow를 얹는다. 모든 나무 재질이 이
// 하나의 uniform 객체를 "참조"로 공유하게 만들어서(아래 applyRimLight), 매
// 프레임 uTime 하나만 갱신해도 수백 그루 전체에 한 번에 반영된다.
var rimUniforms = {
  uRimColor: { value: new THREE.Color(0xfff2c2) },
  uRimPower: { value: 2.4 },
  uRimIntensity: { value: 1.6 },
  uSunDir: { value: new THREE.Vector3(SUN_POS.x, SUN_POS.y, SUN_POS.z).normalize() },
  uTime: { value: 0 }
};

// MeshPhongMaterial의 기존 퐁 셰이딩(그림자·스펙큘러 포함)은 그대로 둔 채,
// onBeforeCompile로 프래그먼트 셰이더 끝부분(outgoingLight가 확정된 직후,
// 최종 출력 직전인 opaque_fragment 청크 앞)에 프레넬 기반 림 라이트 코드만
// 추가로 끼워 넣는다. customProgramCacheKey를 지정해 three.js가 이 커스텀
// 셰이더를 일반 MeshPhongMaterial과 같은 캐시로 잘못 재사용하지 않게 한다.
function applyRimLight(material) {
  material.onBeforeCompile = function (shader) {
    shader.uniforms.uRimColor = rimUniforms.uRimColor;
    shader.uniforms.uRimPower = rimUniforms.uRimPower;
    shader.uniforms.uRimIntensity = rimUniforms.uRimIntensity;
    shader.uniforms.uSunDir = rimUniforms.uSunDir;
    shader.uniforms.uTime = rimUniforms.uTime;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      'uniform vec3 uRimColor;\n' +
      'uniform float uRimPower;\n' +
      'uniform float uRimIntensity;\n' +
      'uniform vec3 uSunDir;\n' +
      'uniform float uTime;\n' +
      '#include <common>'
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      '{\n' +
      '  vec3 rimViewDir = normalize(vViewPosition);\n' +
      '  float rim = pow(1.0 - clamp(dot(rimViewDir, normal), 0.0, 1.0), uRimPower);\n' +
      '  float sunFacing = smoothstep(-0.5, 0.6, dot(normal, uSunDir));\n' +
      '  float shimmer = 0.7 + 0.3 * sin(uTime * 2.6 + (vViewPosition.x + vViewPosition.z) * 0.08);\n' +
      '  outgoingLight += uRimColor * rim * sunFacing * uRimIntensity * shimmer;\n' +
      '}\n' +
      '#include <opaque_fragment>'
    );
  };
  material.customProgramCacheKey = function () { return 'treeRimLight'; };
}

function makeRadialTexture(stops, size) {
  var c = document.createElement('canvas');
  c.width = c.height = size;
  var ctx = c.getContext('2d');
  var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function addSun() {
  var glowTex = makeRadialTexture([
    [0, 'rgba(255,252,235,1)'],
    [0.25, 'rgba(255,246,210,0.9)'],
    [0.6, 'rgba(255,238,180,0.35)'],
    [1, 'rgba(255,238,180,0)']
  ], 256);
  var mat = new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  var glow = new THREE.Sprite(mat);
  glow.scale.set(1600, 1600, 1);
  glow.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
  scene.add(glow);

  var coreTex = makeRadialTexture([
    [0, 'rgba(255,255,250,1)'],
    [0.5, 'rgba(255,253,240,1)'],
    [1, 'rgba(255,253,240,0)']
  ], 128);
  var coreMat = new THREE.SpriteMaterial({ map: coreTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  var core = new THREE.Sprite(coreMat);
  core.scale.set(340, 340, 1);
  core.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
  scene.add(core);
}

// 눈밭에 흩뿌려진 반짝이는 점들 — 햇빛이 눈 결정에 반사돼 반짝이는 느낌을
// 저비용으로 흉내낸다. 정점(포인트) 단위로만 계산해서 개수가 많지 않고,
// 화면 전체를 훑는 프래그먼트 연산이 없어 가볍다.
function addSnowSparkle() {
  var count = 500;
  var positions = new Float32Array(count * 3);
  var phases = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    var a = Math.random() * Math.PI * 2;
    var r = Math.random() * 1800;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -28 + Math.random() * 3;
    positions[i * 3 + 2] = Math.sin(a) * r;
    phases[i] = Math.random() * Math.PI * 2;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  var dotTex = makeRadialTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 32);
  sparkleMat = new THREE.ShaderMaterial({
    uniforms: { u_time: { value: 0 }, u_tex: { value: dotTex } },
    vertexShader:
      'attribute float phase;' +
      'uniform float u_time;' +
      'varying float vAlpha;' +
      'void main() {' +
      '  vAlpha = 0.3 + 0.7 * (0.5 + 0.5 * sin(u_time * 2.2 + phase));' +
      '  vec4 mv = modelViewMatrix * vec4(position, 1.0);' +
      '  gl_PointSize = (4.0 + 3.0 * sin(u_time * 1.7 + phase * 1.3)) * (600.0 / -mv.z);' +
      '  gl_Position = projectionMatrix * mv;' +
      '}',
    fragmentShader:
      'precision mediump float;' +
      'uniform sampler2D u_tex;' +
      'varying float vAlpha;' +
      'void main() {' +
      '  vec4 tex = texture2D(u_tex, gl_PointCoord);' +
      '  gl_FragColor = vec4(vec3(1.0, 0.98, 0.9), tex.a * vAlpha);' +
      '}',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  scene.add(new THREE.Points(geo, sparkleMat));
}

function makeTree() {
  var group = new THREE.Group();

  var trunkGeo = new THREE.CylinderGeometry(6, 8, 60, 6, 1);
  var trunkMat = new THREE.MeshPhongMaterial({ color: 0x5b4a3f, flatShading: true });
  applyRimLight(trunkMat);
  var trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = -20;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
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
    applyRimLight(mat);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 55 - i * 20;
    var rot = i > 0 ? (Math.random() - 0.5) * 0.08 : 0;
    mesh.rotation.set(rot, 0, rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

function buildScene() {
  scene = new THREE.Scene();
  // 채도 낮은 저녁 톤 대신 밝은 대낮 하늘로 — 안개도 더 옅고 멀리까지 보이게
  scene.fog = new THREE.Fog(0xcfe9fb, 1100, 3200);
  scene.background = new THREE.Color(0xbfe2fb);

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 5000);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 나무가 눈밭에 부드러운 그림자를 드리우게
  renderer.toneMapping = THREE.ACESFilmicToneMapping; // 블룸과 잘 어울리는 필름톤 색감
  renderer.toneMappingExposure = 1.15;

  // 전체적으로 더 밝게 + 따뜻한 햇볕 색의 직사광을 강하게(태양 스프라이트와 같은 위치)
  scene.add(new THREE.AmbientLight(0xeaf3fb, 1.25));
  var dirLight = new THREE.DirectionalLight(0xfff2d6, 1.35);
  dirLight.position.set(SUN_POS.x, SUN_POS.y, SUN_POS.z);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1536, 1536);
  dirLight.shadow.camera.near = 200;
  dirLight.shadow.camera.far = 2600;
  dirLight.shadow.camera.left = -1400;
  dirLight.shadow.camera.right = 1400;
  dirLight.shadow.camera.top = 1400;
  dirLight.shadow.camera.bottom = -1400;
  dirLight.shadow.bias = -0.0015;
  scene.add(dirLight);
  var fillLight = new THREE.DirectionalLight(0xd9ecff, 0.35); // 그림자 쪽도 완전히 어둡지 않게 보조광
  fillLight.position.set(-600, 400, -400);
  scene.add(fillLight);

  addSun();

  var groundGeo = new THREE.PlaneGeometry(5000, 5000);
  var groundMat = new THREE.MeshPhongMaterial({
    color: 0xfbfdff, flatShading: true,
    shininess: 70, specular: 0xffffff // 눈 표면이 햇빛을 받아 반짝이는 하이라이트
  });
  var ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -30;
  ground.receiveShadow = true;
  scene.add(ground);

  addSnowSparkle();

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

  buildComposer();
}

// 원본 CodePen 특유의 "미니어처 디오라마" 느낌을 내는 후처리 파이프라인 —
// 블룸(밝은 곳이 은은하게 번짐) + 수평·수직 틸트시프트 블러(화면 중앙 띠만
// 선명하고 위아래로 갈수록 흐려져 장난감 모형처럼 보이는 효과).
function buildComposer() {
  var w = window.innerWidth, h = window.innerHeight;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  var bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.4, 0.78);
  composer.addPass(bloom);

  var hBlur = new ShaderPass({
    uniforms: THREE.UniformsUtils.clone(TiltShiftShader.uniforms),
    vertexShader: TiltShiftShader.vertexShader,
    fragmentShader: TiltShiftShader.fragmentShaderH
  });
  var vBlur = new ShaderPass({
    uniforms: THREE.UniformsUtils.clone(TiltShiftShader.uniforms),
    vertexShader: TiltShiftShader.vertexShader,
    fragmentShader: TiltShiftShader.fragmentShaderV
  });
  var bluriness = 4; // 원본 값(6)에서 강도 33% 감소
  hBlur.uniforms.h.value = bluriness / w;
  vBlur.uniforms.v.value = bluriness / h;
  hBlur.uniforms.r.value = vBlur.uniforms.r.value = 0.58; // 초점 띠를 화면 중앙보다 살짝 아래(지평선 쪽)에 둔다
  composer.addPass(hBlur);
  composer.addPass(vBlur);

  composer.addPass(new OutputPass());
}

function onResize() {
  if (!renderer || !camera) return;
  var w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h);
  if (composer) {
    composer.setSize(w, h);
    var bluriness = 4;
    var passes = composer.passes;
    for (var i = 0; i < passes.length; i++) {
      if (passes[i].uniforms && passes[i].uniforms.h) passes[i].uniforms.h.value = bluriness / w;
      if (passes[i].uniforms && passes[i].uniforms.v) passes[i].uniforms.v.value = bluriness / h;
    }
  }
}

function renderFrame() {
  camera.position.set(Math.cos(angle) * ORBIT_RADIUS, ORBIT_HEIGHT, Math.sin(angle) * ORBIT_RADIUS);
  camera.lookAt(0, 80, 0);
  if (composer) composer.render(); else renderer.render(scene, camera);
}

function animate() {
  rafId = requestAnimationFrame(animate);
  var dt = clock.getDelta();
  angle += ORBIT_SPEED * dt;
  elapsed += dt;
  if (sparkleMat) sparkleMat.uniforms.u_time.value = elapsed;
  rimUniforms.uTime.value = elapsed;
  renderFrame();
}

function show() {
  if (canvas) return; // 이미 떠 있음
  try {
    reducedMotion = isReducedMotion();
    buildScene();
  } catch (e) {
    scene = camera = renderer = composer = null;
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
  scene = camera = renderer = composer = canvas = clock = sparkleMat = null;
  angle = 0;
  elapsed = 0;
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
