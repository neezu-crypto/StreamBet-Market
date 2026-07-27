// 16번 — 불꽃놀이 야시장 테마 배경. CodePen "Fireworks 2026 + Boom Sound"
// (Sabo Sugi, MIT, https://codepen.io/sabosugi/pen/ByzBXQW)의 방식을 그대로
// 가져왔다 — three.js WebGL 포인트 파티클 + UnrealBloomPass(겨울 3D 숲과 동일한
// 후처리)로 실제 발광하는 불꽃놀이를 그리고, Web Audio API로 오디오 파일 없이
// 직접 합성한 "쿵" 하는 폭발음을 재생한다. 개발용 GUI(lil-gui)는 빼고, 색상·
// 발사 위치 등 모든 무작위 요소는 원본처럼 매번 Math.random()으로 새로 뽑는다
// (고정 시드 없음).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 후보정 — ACES 필름톤 매핑(겨울 3D 숲과 동일)으로 블룸 하이라이트에 좀 더
// 영화 같은 색 반응을 주고, 비네트로 화면 가장자리를 살짝 어둡게 눌러 시선이
// 중앙(불꽃)에 모이게 한다.
var VignetteShader = {
  uniforms: { tDiffuse: { value: null }, darkness: { value: 1.1 } },
  vertexShader:
    'varying vec2 vUv;' +
    'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader:
    'precision mediump float;' +
    'uniform sampler2D tDiffuse; uniform float darkness; varying vec2 vUv;' +
    'void main() {' +
    '  vec4 texel = texture2D(tDiffuse, vUv);' +
    '  vec2 uv = vUv - 0.5;' +
    '  float vig = 1.0 - dot(uv, uv) * darkness;' +
    '  gl_FragColor = vec4(texel.rgb * clamp(vig, 0.0, 1.0), texel.a);' +
    '}'
};

// 필름 그레인 — 화면 전체에 시간에 따라 흔들리는 미세한 노이즈를 얹어 아날로그
// 필름 같은 질감을 준다. uv 기반 의사난수라 별도 텍스처 없이 순수 셰이더로 계산.
var FilmGrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.035 } },
  vertexShader:
    'varying vec2 vUv;' +
    'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader:
    'precision mediump float;' +
    'uniform sampler2D tDiffuse; uniform float uTime; uniform float uAmount; varying vec2 vUv;' +
    'float grainRand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }' +
    'void main() {' +
    '  vec4 texel = texture2D(tDiffuse, vUv);' +
    '  float n = (grainRand(vUv * 1000.0 + uTime) - 0.5) * uAmount;' +
    '  gl_FragColor = vec4(texel.rgb + n, texel.a);' +
    '}'
};

var CONFIG = {
  particleCount: 8000,
  particleSize: 0.8,
  fadeSpeed: 0.00482,
  explosionForce: 3.3975,
  hoverDuration: 1.5,
  gravity: 0.00265,
  friction: 0.95494,
  rocketSpeed: 1.0,
  rocketSize: 2.0,
  bloomStrength: 1.495,
  bloomRadius: 0.5,
  launchInterval: 3856.5,
  soundEnabled: true,
  volume: 0.15, // 사운드 최대 크기 제한
  filmGrainAmount: 0.0175,
  dofFocusRange: 90, // 초점 거리에서 이 값(월드 유닛)만큼 벗어나면 최대로 흐려짐
  dofMaxSizeMult: 2.2, // 초점 밖 파티클의 최대 확대 배율(흐린 원반 느낌)
  dofMaxFade: 0.45, // 초점 밖 파티클의 최대 밝기 감쇠
  flareDuration: 0.6,
  flareSize: 46
};

// --- 오디오(딥 베이스 "쿵" 폭발음) — 오디오 파일 없이 오실레이터 + 노이즈로 직접 합성 ---
var AudioSys = {
  ctx: null,
  enabled: false,
  volume: CONFIG.volume,
  limiter: null,
  init: function () {
    if (!this.ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 40;
      this.limiter.ratio.value = 12;
      this.limiter.connect(this.ctx.destination);
      this.enabled = true;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  playDeepExplosion: function () {
    if (!this.enabled || !this.ctx) return;
    var t = this.ctx.currentTime;

    var osc = this.ctx.createOscillator();
    var oscGain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(50, t);
    osc.frequency.exponentialRampToValueAtTime(20, t + 2.5);
    oscGain.gain.setValueAtTime(this.volume * 1.5, t);
    oscGain.gain.exponentialRampToValueAtTime(0.01, t + 5.0);
    osc.connect(oscGain);
    oscGain.connect(this.limiter);
    osc.start(t);
    osc.stop(t + 5.0);

    var bufferSize = this.ctx.sampleRate * 5.0;
    var buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    var noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    var noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(150, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(30, t + 4.0);
    var noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(this.volume * 1.0, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 4.5);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.limiter);
    noise.start(t);

    var crack = this.ctx.createOscillator();
    crack.type = 'triangle';
    var crackGain = this.ctx.createGain();
    crack.frequency.setValueAtTime(200, t);
    crack.frequency.exponentialRampToValueAtTime(50, t + 0.1);
    crackGain.gain.setValueAtTime(this.volume * 0.3, t);
    crackGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
    crack.connect(crackGain);
    crackGain.connect(this.limiter);
    crack.start(t);
    crack.stop(t + 0.1);
  }
};

// 가우시안류 곡선을 다수의 색상 정지점으로 샘플링해 방사형/선형 그라디언트에
// 채운다 — 정지점을 3~5개만 쓰던 예전 방식은 확대·블룸을 거치면 계단(밴딩)이
// 보이기 쉬운데, 곡선을 32단계로 촘촘히 샘플링하면 사실상 연속적인 부드러운
// 발광으로 보인다.
var GRADIENT_STEPS = 32;
function fillGaussianRadial(ctx, cx, cy, r, curve) {
  var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (var i = 0; i <= GRADIENT_STEPS; i++) {
    var t = i / GRADIENT_STEPS;
    var a = Math.max(0, Math.min(1, curve(t)));
    grad.addColorStop(t, 'rgba(255,255,255,' + a.toFixed(4) + ')');
  }
  return grad;
}
function fillGaussianLinear(ctx, x0, y0, x1, y1, curve) {
  var grad = ctx.createLinearGradient(x0, y0, x1, y1);
  for (var i = 0; i <= GRADIENT_STEPS; i++) {
    var t = i / GRADIENT_STEPS;
    var a = Math.max(0, Math.min(1, curve(t)));
    grad.addColorStop(t, 'rgba(255,255,255,' + a.toFixed(4) + ')');
  }
  return grad;
}

// 파티클용 기본 발광 스프라이트 — 중심의 밝고 단단한 코어(좁은 가우시안)와
// 그 바깥을 감싸는 넓고 옅은 헤일로(넓은 가우시안)를 합쳐서, 실제 사진에서
// 밝은 광원이 렌즈에 맺히는 느낌에 가깝게 만든다. 128px 해상도라 화면에
// 크게 확대돼도(블룸까지 겹쳐도) 계단/밴딩 없이 매끈하다.
function getSprite() {
  var size = 128, cx = size / 2, cy = size / 2, r = size / 2;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = fillGaussianRadial(ctx, cx, cy, r, function (t) {
    return Math.exp(-t * t * 7.0) + 0.55 * Math.exp(-t * t * 2.2);
  });
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// 별 모양 스프라이트 — 파티클 형태에 변화를 주기 위해 원형 글로우 외에 5각별
// 실루엣을 발광 그라데이션과 함께 그려서 별도의 텍스처로 만든다.
function getStarSprite() {
  var size = 128, cx = size / 2, cy = size / 2;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  var spikes = 5, outerR = size * 0.47, innerR = size * 0.19;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 2);
  ctx.beginPath();
  for (var i = 0; i < spikes * 2; i++) {
    var r = i % 2 === 0 ? outerR : innerR;
    var a = (i * Math.PI) / spikes;
    ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  ctx.closePath();
  ctx.restore();
  ctx.fillStyle = fillGaussianRadial(ctx, cx, cy, size / 2, function (t) {
    return Math.exp(-t * t * 4.0);
  });
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

// --- 렌즈 플레어용 고스트 텍스처 3종 (모두 순수 캔버스 절차 생성 — 외부
// 이미지 자산 없이 이 씬의 다른 스프라이트들과 동일한 방식) ---

// 속이 빈 고리(halo ring) — 반사면 사이에서 튕겨 생기는 도넛 모양 고스트.
// 링 반경(ringT) 위치에서 봉우리를 이루는 가우시안 "종 모양"을 반경 방향으로
// 그려서, 예전의 stroke 기반 하드 엣지 링보다 훨씬 부드러운 도넛이 된다.
function getRingSprite() {
  var size = 128, cx = size / 2, cy = size / 2, r = size / 2;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  var ringT = 0.5, spread = 55;
  ctx.fillStyle = fillGaussianRadial(ctx, cx, cy, r, function (t) {
    var d = t - ringT;
    return Math.exp(-d * d * spread);
  });
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// 6각형 조리개(iris) 블롭 — 카메라 조리개 날 모양이 그대로 찍히는 작은 고스트.
function getHexSprite() {
  var size = 128, cx = size / 2, cy = size / 2;
  var canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  var ctx = canvas.getContext('2d');
  var sides = 6, r = size * 0.4;
  ctx.beginPath();
  for (var i = 0; i < sides; i++) {
    var a = (i / sides) * Math.PI * 2 - Math.PI / 2;
    var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = fillGaussianRadial(ctx, cx, cy, r, function (t) {
    return Math.exp(-t * t * 3.0);
  });
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

// 가로로 넓게 퍼지는 아나모픽 스트릭 — 실제 조리개 소스 지점에만 붙는
// 얇고 긴 하이라이트 줄기(빔). 스프라이트의 x/y 스케일을 다르게 줘서
// 이 텍스처 하나로 다양한 종횡비를 표현한다. 가로·세로 모두 가우시안
// 곡선으로 부드럽게 감쇠시켜 예전의 5단계 정지점 대비 훨씬 매끈하다.
function getStreakSprite() {
  var w = 512, h = 64;
  var canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = fillGaussianLinear(ctx, 0, 0, w, 0, function (t) {
    var d = (t - 0.5) * 2.0;
    return Math.exp(-d * d * 8.0);
  });
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = fillGaussianLinear(ctx, 0, 0, 0, h, function (t) {
    var d = (t - 0.5) * 2.0;
    return Math.exp(-d * d * 3.0);
  });
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(canvas);
}

// 파티클 포인트 스프라이트용 커스텀 셰이더 — PointsMaterial은 포인트 단위
// 회전을 지원하지 않아서, 회전(aRotation)을 프래그먼트 셰이더에서 gl_PointCoord를
// 돌려 텍스처를 샘플링하는 방식으로 직접 구현한다. 사이즈 감쇠(uScale)는
// three.js가 내부적으로 쓰는 "렌더러 물리 픽셀 높이 / 2" 공식을 그대로 따라서
// 기존 PointsMaterial과 크기 체감이 달라지지 않게 맞춘다.
// 피사계심도(DoF) — 원래는 EffectComposer의 BokehPass(장면을 MeshDepthMaterial로
// 덮어 그려 깊이 버퍼를 얻는 범용 후처리)를 썼는데, 그 깊이 셰이더는 gl_PointSize를
// 전혀 설정하지 않고 Sprite 빌보드도 지원하지 않는다 — 이 씬은 파티클/로켓/별이
// 전부 Points, 플레어가 전부 Sprite라 사실상 깊이 버퍼에 아무 것도 안 찍혀서
// 흐림이 화면 전체에 균일하게 적용되는 것처럼 보였다. 그래서 포스트 프로세싱
// 대신 스파크 셰이더 안에서 직접 카메라와의 거리(초점과의 차이)를 계산해,
// 초점 밖 파티클일수록 포인트 크기를 키우고(흐릿한 원반처럼 보이게) 밝기를
// 살짝 낮추는 "가짜 보케"를 파티클 단위로 적용한다 — 포인트 기반 씬에는 이
// 방식이 실제로 더 정확하다.
var SparkShader = {
  vertexShader:
    'attribute vec3 color;' +
    'attribute float aRotation;' +
    'varying vec3 vColor;' +
    'varying float vRotation;' +
    'varying float vCoc;' +
    'uniform float uSize;' +
    'uniform float uScale;' +
    'uniform float uFocus;' +
    'uniform float uFocusRange;' +
    'uniform float uMaxSizeMult;' +
    'void main() {' +
    '  vColor = color;' +
    '  vRotation = aRotation;' +
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);' +
    '  float viewDist = -mvPosition.z;' +
    '  float coc = clamp(abs(viewDist - uFocus) / uFocusRange, 0.0, 1.0);' +
    '  vCoc = coc;' +
    '  float sizeMult = mix(1.0, uMaxSizeMult, coc);' +
    '  gl_PointSize = uSize * sizeMult * uScale / viewDist;' +
    '  gl_Position = projectionMatrix * mvPosition;' +
    '}',
  fragmentShader:
    'precision mediump float;' +
    'uniform sampler2D uMap;' +
    'uniform float uMaxFade;' +
    'varying vec3 vColor;' +
    'varying float vRotation;' +
    'varying float vCoc;' +
    'void main() {' +
    '  vec2 uv = gl_PointCoord - 0.5;' +
    '  float s = sin(vRotation); float c = cos(vRotation);' +
    '  vec2 ruv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;' +
    '  vec4 texel = texture2D(uMap, ruv);' +
    '  float fade = 1.0 - vCoc * uMaxFade;' +
    '  gl_FragColor = vec4(vColor * texel.rgb * fade, texel.a * fade);' +
    '}'
};

var scene = null, camera = null, renderer = null, composer = null, canvas = null;
var particleSprite = null;
var particleSpriteStar = null;
var sparkScaleValue = 400;
var flareTexRing = null;
var flareTexHex = null;
var flareTexStreak = null;
var flareNdcScratch = new THREE.Vector3();
var flareNearScratch = new THREE.Vector3();
var flareFarScratch = new THREE.Vector3();
var flareDirScratch = new THREE.Vector3();
var flareWorldScratch = new THREE.Vector3();
var FLARE_DEPTH = 190; // 카메라 앞 고정 거리 — 이 씬에서 불꽃이 보통 터지는 거리대와 맞춘 값
var fireworks = [];
var clock = null;
var rafId = null;
var lastLaunchTime = 0;
var nextLaunchDelay = 0;
var reducedMotion = false;
var audioUnlockHandler = null;

// 카메라 무빙 — 회전(orbit) 대신 드론이 8자(∞) 궤적을 그리며 나는 느낌.
// 8자형(lemniscate)은 x = sin(t), z-오프셋 = sin(t)*cos(t)로 만들고, 높이도
// 살짝 다른 주기로 흔들어 실제 드론 촬영처럼 불규칙한 입체감을 준다. 항상
// CAM_LOOK_TARGET을 바라보게 해서(lookAt) 폭죽이 계속 화면 중심에 걸린다.
var CAM_LOOK_TARGET = new THREE.Vector3(0, 15, 0);
var CAM_RADIUS_X = 130;
var CAM_RADIUS_Z = 100;
var CAM_BASE_Z = 150;
var CAM_HEIGHT_VARY = 18;
var CAM_SPEED = 0.09; // 라디안/초 — 8자 한 바퀴 도는 데 약 70초
var camAngle = 0;

function updateCameraPath(dt) {
  camAngle += CAM_SPEED * dt;
  var x = CAM_RADIUS_X * Math.sin(camAngle);
  var z = CAM_BASE_Z + CAM_RADIUS_Z * Math.sin(camAngle) * Math.cos(camAngle);
  var y = CAM_LOOK_TARGET.y + CAM_HEIGHT_VARY * Math.sin(camAngle * 0.5 + 1.2);
  camera.position.set(x, y, z);
  camera.lookAt(CAM_LOOK_TARGET);
}

function isReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function Firework(startX) {
  this.isDead = false;
  this.phase = 'rocket';
  this.timer = 0;

  var rand = Math.random();
  var baseHue = Math.random();
  this.colors = [];
  if (rand < 0.33) {
    this.colors.push(new THREE.Color().setHSL(baseHue, 1.0, 0.6));
  } else if (rand < 0.66) {
    this.colors.push(new THREE.Color().setHSL(baseHue, 1.0, 0.6));
    this.colors.push(new THREE.Color().setHSL((baseHue + 0.5) % 1.0, 1.0, 0.5));
  } else {
    this.colors.push(new THREE.Color().setHSL(baseHue, 1.0, 0.6));
    this.colors.push(new THREE.Color().setHSL((baseHue + 0.33) % 1.0, 1.0, 0.6));
    this.colors.push(new THREE.Color().setHSL((baseHue + 0.66) % 1.0, 1.0, 0.6));
  }

  var burstRand = Math.random();
  if (burstRand < 0.4) this.burstType = 'sphere';
  else if (burstRand < 0.65) this.burstType = 'ring';
  else if (burstRand < 0.85) this.burstType = 'double';
  else this.burstType = 'streamer';

  this.spriteType = Math.random() < 0.5 ? 'round' : 'star';

  this.pos = new THREE.Vector3(startX, -80, (Math.random() - 0.5) * 50);
  this.vel = new THREE.Vector3(
    (Math.random() - 0.5) * 0.5,
    CONFIG.rocketSpeed * (0.9 + Math.random() * 0.3),
    (Math.random() - 0.5) * 0.5
  );
  this.targetY = -10 + Math.random() * 30;

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.toArray(), 3));
  this.rocketMesh = new THREE.Points(geo, new THREE.PointsMaterial({
    size: CONFIG.rocketSize,
    color: this.colors[0],
    map: particleSprite,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  scene.add(this.rocketMesh);
}

Firework.prototype.update = function (dt) {
  if (this.sparkSystem) this.sparkSystem.material.uniforms.uSize.value = CONFIG.particleSize;
  if (this.rocketMesh) this.rocketMesh.material.size = CONFIG.rocketSize;

  if (this.phase === 'rocket') {
    this.pos.add(this.vel);
    this.vel.y *= 0.99;
    this.rocketMesh.geometry.attributes.position.setXYZ(0, this.pos.x, this.pos.y, this.pos.z);
    this.rocketMesh.geometry.attributes.position.needsUpdate = true;
    if (this.vel.y < 0.2 || this.pos.y >= this.targetY) this.explode();
  } else {
    this.timer += dt;

    if (this.flareGhosts) {
      this.flareTimer += dt;
      var flareT = Math.min(1, this.flareTimer / CONFIG.flareDuration);
      var flareAlpha = (1 - flareT) * (1 - flareT);
      var ndc = flareNdcScratch.copy(this.pos).project(camera);
      var behindCamera = ndc.z > 1 || ndc.z < -1 || flareAlpha <= 0.001;
      for (var g = 0; g < this.flareGhosts.length; g++) {
        var ghost = this.flareGhosts[g];
        if (behindCamera) { ghost.obj.visible = false; continue; }
        ghost.obj.visible = true;
        // 소스(distance=0)~화면 중심(distance=1)을 잇는 직선 위, 그리고 그
        // 너머(distance>1, 반대편)까지 고스트를 배치하는 표준 렌즈플레어 공식.
        var gx = ndc.x * (1 - ghost.distance);
        var gy = ndc.y * (1 - ghost.distance);
        // NDC (gx,gy)를 지나는 카메라 광선을 near/far 두 점으로 구해 방향을
        // 뽑고, 카메라로부터 고정 거리(FLARE_DEPTH)에 배치한다. near-plane
        // 근처(ndc.z가 -1에 가까운 값)로 직접 unproject하면 원근 투영의
        // 비선형성 때문에 카메라에서 실제 거리가 극히 작게 나와 스프라이트가
        // 거의 안 보이게 되는 문제가 있어, 이 방식으로 우회한다.
        var nearP = flareNearScratch.set(gx, gy, -1).unproject(camera);
        var farP = flareFarScratch.set(gx, gy, 1).unproject(camera);
        var rayDir = flareDirScratch.subVectors(farP, nearP).normalize();
        var worldPos = flareWorldScratch.copy(camera.position).addScaledVector(rayDir, FLARE_DEPTH);
        ghost.obj.position.copy(worldPos);
        ghost.obj.scale.set(ghost.sizeX, ghost.sizeY, 1);
        ghost.obj.material.opacity = flareAlpha * ghost.baseOpacity;
      }
      if (flareT >= 1) {
        for (var g2 = 0; g2 < this.flareGhosts.length; g2++) {
          scene.remove(this.flareGhosts[g2].obj);
          this.flareGhosts[g2].obj.material.dispose();
        }
        this.flareGhosts = null;
      }
    }

    var positions = this.sparkSystem.geometry.attributes.position.array;
    var colors = this.sparkSystem.geometry.attributes.color.array;
    var rotations = this.sparkSystem.geometry.attributes.aRotation.array;
    var aliveCount = 0;
    var isHovering = this.timer < CONFIG.hoverDuration;
    var gravityFactor = THREE.MathUtils.smoothstep(this.timer, CONFIG.hoverDuration, CONFIG.hoverDuration + 0.5);

    for (var i = 0; i < this.currentParticleCount; i++) {
      if (this.lifetimes[i] > 0) {
        aliveCount++;
        var i3 = i * 3;
        positions[i3] += this.velocities[i3];
        positions[i3 + 1] += this.velocities[i3 + 1];
        positions[i3 + 2] += this.velocities[i3 + 2];
        rotations[i] += this.rotSpeeds[i] * dt;

        if (isHovering) {
          this.velocities[i3] *= CONFIG.friction;
          this.velocities[i3 + 1] *= CONFIG.friction;
          this.velocities[i3 + 2] *= CONFIG.friction;
        } else {
          this.velocities[i3 + 1] -= CONFIG.gravity * gravityFactor;
          this.velocities[i3] *= 0.98;
          this.velocities[i3 + 1] *= 0.98;
          this.velocities[i3 + 2] *= 0.98;
          this.lifetimes[i] -= CONFIG.fadeSpeed;
        }

        // 색 식힘(cooling) — 터진 직후엔 흰빛에 가깝게 밝다가(hot), 수명이
        // 줄어들수록 고유 색으로, 이후 밝기와 함께 어두워지며 꺼진다.
        var alpha = Math.max(0, this.lifetimes[i]);
        var coolT = Math.min(1, Math.max(0, (1.0 - alpha) / 0.35));
        colors[i3] = THREE.MathUtils.lerp(1.0, this.baseColors[i3], coolT) * alpha * 1.5;
        colors[i3 + 1] = THREE.MathUtils.lerp(1.0, this.baseColors[i3 + 1], coolT) * alpha * 1.5;
        colors[i3 + 2] = THREE.MathUtils.lerp(1.0, this.baseColors[i3 + 2], coolT) * alpha * 1.5;
      }
    }
    this.sparkSystem.geometry.attributes.position.needsUpdate = true;
    this.sparkSystem.geometry.attributes.color.needsUpdate = true;
    this.sparkSystem.geometry.attributes.aRotation.needsUpdate = true;
    if (aliveCount === 0) this.cleanup();
  }
};

Firework.prototype.explode = function () {
  if (CONFIG.soundEnabled) AudioSys.playDeepExplosion();
  scene.remove(this.rocketMesh);
  this.phase = 'explode';
  this.timer = 0;
  this.currentParticleCount = CONFIG.particleCount;

  // 렌즈 플레어 — 실제 카메라 렌즈처럼 소스~화면 중심을 잇는 축 위에 여러
  // "고스트"(아나모픽 스트릭 + 코어 + 6각 조리개 고스트 + 링 고스트)를 화면
  // 좌표계(NDC) 기준으로 배치하는 고스트 체인 방식. THREE.Lensflare 내장
  // 오클루전(프레임버퍼 복사) 방식은 EffectComposer 체인과 충돌 위험이 있어
  // 쓰지 않고, 매 프레임 직접 스프라이트를 화면 좌표로 재배치한다.
  this.flareTimer = 0;
  var flareColorA = this.colors[0];
  var flareColorB = this.colors.length > 1 ? this.colors[1] : this.colors[0];
  var flareWhite = new THREE.Color(1, 1, 1);
  var flareDefs = [
    { texture: flareTexStreak, distance: 0.0, sizeX: CONFIG.flareSize * 2.4, sizeY: CONFIG.flareSize * 0.22, color: flareWhite, baseOpacity: 0.9 },
    { texture: particleSprite, distance: 0.0, sizeX: CONFIG.flareSize * 0.9, sizeY: CONFIG.flareSize * 0.9, color: flareWhite, baseOpacity: 1.0 },
    { texture: flareTexHex, distance: 0.35, sizeX: CONFIG.flareSize * 0.32, sizeY: CONFIG.flareSize * 0.32, color: flareColorA.clone().lerp(flareWhite, 0.3), baseOpacity: 0.55 },
    { texture: flareTexRing, distance: 0.65, sizeX: CONFIG.flareSize * 0.5, sizeY: CONFIG.flareSize * 0.5, color: flareColorB.clone().lerp(flareWhite, 0.2), baseOpacity: 0.45 },
    { texture: flareTexHex, distance: 0.9, sizeX: CONFIG.flareSize * 0.18, sizeY: CONFIG.flareSize * 0.18, color: flareColorA.clone(), baseOpacity: 0.35 },
    { texture: flareTexHex, distance: 1.15, sizeX: CONFIG.flareSize * 0.24, sizeY: CONFIG.flareSize * 0.24, color: flareColorB.clone().multiplyScalar(0.7), baseOpacity: 0.3 }
  ];
  this.flareGhosts = flareDefs.map(function (def) {
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: def.texture,
      color: def.color,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0
    }));
    sprite.visible = false;
    scene.add(sprite);
    return { obj: sprite, distance: def.distance, sizeX: def.sizeX, sizeY: def.sizeY, baseOpacity: def.baseOpacity };
  });

  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(this.currentParticleCount * 3);
  var colors = new Float32Array(this.currentParticleCount * 3);
  var rotations = new Float32Array(this.currentParticleCount);
  this.baseColors = new Float32Array(this.currentParticleCount * 3);
  this.velocities = new Float32Array(this.currentParticleCount * 3);
  this.lifetimes = new Float32Array(this.currentParticleCount);
  this.rotSpeeds = new Float32Array(this.currentParticleCount);

  var baseSpeed = CONFIG.explosionForce * (0.8 + Math.random() * 0.4);

  // 링형 버스트용 랜덤 평면 기저 벡터 (u, v가 폭발 평면을 이룸)
  var ringNormal = new THREE.Vector3(
    Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5
  ).normalize();
  var ringHelper = Math.abs(ringNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  var ringU = new THREE.Vector3().crossVectors(ringNormal, ringHelper).normalize();
  var ringV = new THREE.Vector3().crossVectors(ringNormal, ringU).normalize();

  // 이중 폭발용 안쪽/바깥쪽 색상 (colors가 1개뿐이면 밝기 차이로 대체)
  var innerColor = this.colors[0];
  var outerColor = this.colors.length > 1 ? this.colors[1] : this.colors[0];

  // 스트리머(리본)용: 소수의 방향에 여러 파티클을 다른 속도로 배치해 늘어지는 궤적을 만든다
  var streamerLineCount = Math.max(16, Math.floor(this.currentParticleCount / 40));
  var streamerPerLine = Math.ceil(this.currentParticleCount / streamerLineCount);

  for (var i = 0; i < this.currentParticleCount; i++) {
    var i3 = i * 3;
    positions[i3] = this.pos.x; positions[i3 + 1] = this.pos.y; positions[i3 + 2] = this.pos.z;

    var dirX, dirY, dirZ, speed, targetColor;

    if (this.burstType === 'ring') {
      var ringAngle = Math.random() * Math.PI * 2;
      var thickness = (Math.random() - 0.5) * 0.18;
      dirX = ringU.x * Math.cos(ringAngle) + ringV.x * Math.sin(ringAngle) + ringNormal.x * thickness;
      dirY = ringU.y * Math.cos(ringAngle) + ringV.y * Math.sin(ringAngle) + ringNormal.y * thickness;
      dirZ = ringU.z * Math.cos(ringAngle) + ringV.z * Math.sin(ringAngle) + ringNormal.z * thickness;
      speed = baseSpeed * (0.9 + Math.random() * 0.2);
      targetColor = this.colors[Math.floor(Math.random() * this.colors.length)];
    } else if (this.burstType === 'double') {
      var theta1 = Math.random() * Math.PI * 2;
      var phi1 = Math.acos(2 * Math.random() - 1);
      dirX = Math.sin(phi1) * Math.cos(theta1);
      dirY = Math.sin(phi1) * Math.sin(theta1);
      dirZ = Math.cos(phi1);
      var isInner = i < this.currentParticleCount * 0.4;
      speed = isInner ? baseSpeed * 0.45 * (0.85 + Math.random() * 0.3) : baseSpeed * (0.85 + Math.random() * 0.3);
      targetColor = isInner ? innerColor : outerColor;
    } else if (this.burstType === 'streamer') {
      var lineIndex = Math.floor(i / streamerPerLine);
      var posInLine = i % streamerPerLine;
      var lineSeed = lineIndex * 12.9898;
      var lineTheta = (Math.sin(lineSeed) * 43758.5453 % 1 + 1) % 1 * Math.PI * 2;
      var linePhi = Math.acos(2 * ((Math.sin(lineSeed * 1.7) * 12345.6789 % 1 + 1) % 1) - 1);
      var jitter = 0.03;
      var theta2 = lineTheta + (Math.random() - 0.5) * jitter;
      var phi2 = linePhi + (Math.random() - 0.5) * jitter;
      dirX = Math.sin(phi2) * Math.cos(theta2);
      dirY = Math.sin(phi2) * Math.sin(theta2);
      dirZ = Math.cos(phi2);
      var lineFrac = streamerPerLine > 1 ? posInLine / (streamerPerLine - 1) : 0;
      speed = baseSpeed * (1.5 - lineFrac * 1.1);
      targetColor = this.colors[Math.floor(Math.random() * this.colors.length)];
    } else {
      var theta = Math.random() * Math.PI * 2;
      var phi = Math.acos(2 * Math.random() - 1);
      dirX = Math.sin(phi) * Math.cos(theta);
      dirY = Math.sin(phi) * Math.sin(theta);
      dirZ = Math.cos(phi);
      speed = baseSpeed * (0.8 + Math.random() * 0.4);
      targetColor = this.colors[Math.floor(Math.random() * this.colors.length)];
    }

    this.velocities[i3] = dirX * speed;
    this.velocities[i3 + 1] = dirY * speed;
    this.velocities[i3 + 2] = dirZ * speed;

    var brightness = 0.5 + Math.random() * 0.8;

    this.baseColors[i3] = targetColor.r * brightness;
    this.baseColors[i3 + 1] = targetColor.g * brightness;
    this.baseColors[i3 + 2] = targetColor.b * brightness;

    colors[i3] = this.baseColors[i3];
    colors[i3 + 1] = this.baseColors[i3 + 1];
    colors[i3 + 2] = this.baseColors[i3 + 2];

    this.lifetimes[i] = 1.0;
    rotations[i] = Math.random() * Math.PI * 2;
    this.rotSpeeds[i] = (Math.random() - 0.5) * 4.0;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aRotation', new THREE.BufferAttribute(rotations, 1));

  this.sparkSystem = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: this.spriteType === 'star' ? particleSpriteStar : particleSprite },
      uSize: { value: CONFIG.particleSize },
      uScale: { value: sparkScaleValue },
      uFocus: { value: camera.position.distanceTo(CAM_LOOK_TARGET) },
      uFocusRange: { value: CONFIG.dofFocusRange },
      uMaxSizeMult: { value: CONFIG.dofMaxSizeMult },
      uMaxFade: { value: CONFIG.dofMaxFade }
    },
    vertexShader: SparkShader.vertexShader,
    fragmentShader: SparkShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  scene.add(this.sparkSystem);
};

Firework.prototype.cleanup = function () {
  this.isDead = true;
  if (this.sparkSystem) {
    scene.remove(this.sparkSystem);
    this.sparkSystem.geometry.dispose();
    this.sparkSystem.material.dispose();
  }
  if (this.rocketMesh) {
    scene.remove(this.rocketMesh);
    this.rocketMesh.geometry.dispose();
    this.rocketMesh.material.dispose();
  }
  if (this.flareGhosts) {
    for (var g = 0; g < this.flareGhosts.length; g++) {
      scene.remove(this.flareGhosts[g].obj);
      this.flareGhosts[g].obj.material.dispose();
    }
    this.flareGhosts = null;
  }
};

function launchFirework() {
  var x = (Math.random() - 0.5) * 150;
  fireworks.push(new Firework(x));
}

function updateQueue(time) {
  if (time - lastLaunchTime > nextLaunchDelay) {
    lastLaunchTime = time;
    nextLaunchDelay = CONFIG.launchInterval + Math.random() * 1000;
    launchFirework();
  }
}

function buildScene() {
  particleSprite = getSprite();
  particleSpriteStar = getStarSprite();
  flareTexRing = getRingSprite();
  flareTexHex = getHexSprite();
  flareTexStreak = getStreakSprite();

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.002);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 0, 150);

  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // 커스텀 스파크 셰이더의 포인트 크기 감쇠 계수 — three.js가 내장 Points
  // 셰이더에서 쓰는 "물리 픽셀 높이 / 2" 공식과 맞춰서 기존 PointsMaterial 대비
  // 파티클 크기 체감이 달라지지 않게 한다.
  sparkScaleValue = window.innerHeight * dpr * 0.5;

  var renderScene = new RenderPass(scene, camera);
  // UnrealBloomPass는 성능을 위해 자체적으로 여러 단계 축소(mip)해서 블러를
  // 계산한 뒤 다시 확대·합성한다 — 여기에 넘기는 해상도가 실제 픽셀 밀도
  // (devicePixelRatio)를 반영하지 않으면, 본 화면(고해상도)보다 훨씬 낮은
  // 해상도로 블러가 계산돼 부드러운 블러 대신 뭉텅뭉텅 픽셀진 블룸이 된다.
  var bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth * dpr, window.innerHeight * dpr),
    CONFIG.bloomStrength, CONFIG.bloomRadius, 0.0
  );
  var vignettePass = new ShaderPass(VignetteShader);
  var filmGrainPass = new ShaderPass(FilmGrainShader);
  filmGrainPass.uniforms.uAmount.value = CONFIG.filmGrainAmount;
  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
  composer.addPass(vignettePass);
  composer.addPass(filmGrainPass);
  composer.addPass(new OutputPass());
  composer.bloomPass = bloomPass;
  composer.filmGrainPass = filmGrainPass;

  var starsGeo = new THREE.BufferGeometry();
  var starsCnt = 3000;
  var sPos = new Float32Array(starsCnt * 3);
  for (var i = 0; i < starsCnt * 3; i++) sPos[i] = (Math.random() - 0.5) * 1200;
  starsGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  var starsMat = new THREE.PointsMaterial({
    size: 1.5, color: 0x888888, map: particleSprite,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  scene.add(new THREE.Points(starsGeo, starsMat));

  fireworks = [];
  lastLaunchTime = 0;
  nextLaunchDelay = 0;
  camAngle = 0;
}

function onResize() {
  if (!renderer || !camera || !composer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  var dpr = renderer.getPixelRatio();
  composer.bloomPass.resolution.set(window.innerWidth * dpr, window.innerHeight * dpr);
  composer.setSize(window.innerWidth, window.innerHeight);
  sparkScaleValue = window.innerHeight * dpr * 0.5;
  for (var i = 0; i < fireworks.length; i++) {
    var mat = fireworks[i].sparkSystem && fireworks[i].sparkSystem.material;
    if (mat && mat.uniforms && mat.uniforms.uScale) mat.uniforms.uScale.value = sparkScaleValue;
  }
}

function animate() {
  rafId = requestAnimationFrame(animate);
  var dt = clock.getDelta();
  updateCameraPath(dt);
  if (composer.filmGrainPass) {
    composer.filmGrainPass.uniforms.uTime.value = clock.elapsedTime;
  }
  // 드론 카메라가 항상 바라보는 지점까지의 거리를 파티클 셰이더의 초점 거리로
  // 매 프레임 갱신 — 그 부근에 몰려 터지는 불꽃은 선명하게, 화면 가장자리·
  // 카메라에 가깝거나 먼 파티클은 살짝 흐려진다.
  var focusDist = camera.position.distanceTo(CAM_LOOK_TARGET);
  updateQueue(performance.now());
  for (var i = fireworks.length - 1; i >= 0; i--) {
    var fw = fireworks[i];
    if (fw.sparkSystem) fw.sparkSystem.material.uniforms.uFocus.value = focusDist;
    fw.update(dt);
    if (fw.isDead) fireworks.splice(i, 1);
  }
  composer.render();
}

function unlockAudioOnFirstInteraction() {
  if (audioUnlockHandler) return;
  audioUnlockHandler = function () { AudioSys.init(); };
  window.addEventListener('pointerdown', audioUnlockHandler, { once: true, passive: true });
  window.addEventListener('keydown', audioUnlockHandler, { once: true });
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
  canvas.id = 'sbm-firework-scene-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);

  window.addEventListener('resize', onResize);
  unlockAudioOnFirstInteraction();

  if (reducedMotion) {
    updateCameraPath(0);
    launchFirework(); // 정적인 상태 대신 최소한 한 번은 터진 모습을 보여준다
    composer.render();
    return;
  }

  clock = new THREE.Clock();
  rafId = requestAnimationFrame(animate);
}

function hide() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  window.removeEventListener('resize', onResize);
  if (audioUnlockHandler) {
    window.removeEventListener('pointerdown', audioUnlockHandler);
    window.removeEventListener('keydown', audioUnlockHandler);
    audioUnlockHandler = null;
  }
  for (var i = 0; i < fireworks.length; i++) fireworks[i].cleanup();
  fireworks = [];
  if (renderer) renderer.dispose();
  if (canvas) canvas.remove();
  scene = camera = renderer = composer = canvas = clock = null;
}

function syncFromHtmlClass() {
  var isActive = document.documentElement.classList.contains('theme-firework-market');
  if (isActive) show(); else hide();
}

// js/skins.js가 html에 theme-* 클래스를 갈아끼우는 방식이라, class 변화를 직접
// 관찰한다(js/winter-scene.js와 동일한 패턴) — 모듈 스크립트 로드 시점과
// skins.js 실행 순서에 의존하지 않아 더 안전하다.
new MutationObserver(syncFromHtmlClass).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class']
});
syncFromHtmlClass(); // 이미 이 테마로 로드된 상태(예: 새로고침)도 반영
