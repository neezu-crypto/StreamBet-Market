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
  trailOpacity: 0.39707,
  launchInterval: 3856.5,
  soundEnabled: true,
  volume: 0.15 // 사운드 최대 크기 제한
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

function getSprite() {
  var canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  var ctx = canvas.getContext('2d');
  var gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

var scene = null, camera = null, renderer = null, composer = null, canvas = null;
var particleSprite = null;
var fullScreenQuad = null;
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
  if (this.sparkSystem) this.sparkSystem.material.size = CONFIG.particleSize;
  if (this.rocketMesh) this.rocketMesh.material.size = CONFIG.rocketSize;

  if (this.phase === 'rocket') {
    this.pos.add(this.vel);
    this.vel.y *= 0.99;
    this.rocketMesh.geometry.attributes.position.setXYZ(0, this.pos.x, this.pos.y, this.pos.z);
    this.rocketMesh.geometry.attributes.position.needsUpdate = true;
    if (this.vel.y < 0.2 || this.pos.y >= this.targetY) this.explode();
  } else {
    this.timer += dt;
    var positions = this.sparkSystem.geometry.attributes.position.array;
    var colors = this.sparkSystem.geometry.attributes.color.array;
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

        var alpha = Math.max(0, this.lifetimes[i]);
        colors[i3] = this.baseColors[i3] * alpha * 1.5;
        colors[i3 + 1] = this.baseColors[i3 + 1] * alpha * 1.5;
        colors[i3 + 2] = this.baseColors[i3 + 2] * alpha * 1.5;
      }
    }
    this.sparkSystem.geometry.attributes.position.needsUpdate = true;
    this.sparkSystem.geometry.attributes.color.needsUpdate = true;
    if (aliveCount === 0) this.cleanup();
  }
};

Firework.prototype.explode = function () {
  if (CONFIG.soundEnabled) AudioSys.playDeepExplosion();
  scene.remove(this.rocketMesh);
  this.phase = 'explode';
  this.timer = 0;
  this.currentParticleCount = CONFIG.particleCount;

  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(this.currentParticleCount * 3);
  var colors = new Float32Array(this.currentParticleCount * 3);
  this.baseColors = new Float32Array(this.currentParticleCount * 3);
  this.velocities = new Float32Array(this.currentParticleCount * 3);
  this.lifetimes = new Float32Array(this.currentParticleCount);

  var baseSpeed = CONFIG.explosionForce * (0.8 + Math.random() * 0.4);

  for (var i = 0; i < this.currentParticleCount; i++) {
    var i3 = i * 3;
    positions[i3] = this.pos.x; positions[i3 + 1] = this.pos.y; positions[i3 + 2] = this.pos.z;

    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos(2 * Math.random() - 1);
    var speed = baseSpeed * (0.8 + Math.random() * 0.4);

    this.velocities[i3] = speed * Math.sin(phi) * Math.cos(theta);
    this.velocities[i3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
    this.velocities[i3 + 2] = speed * Math.cos(phi);

    var targetColor = this.colors[Math.floor(Math.random() * this.colors.length)];
    var brightness = 0.5 + Math.random() * 0.8;

    this.baseColors[i3] = targetColor.r * brightness;
    this.baseColors[i3 + 1] = targetColor.g * brightness;
    this.baseColors[i3 + 2] = targetColor.b * brightness;

    colors[i3] = this.baseColors[i3];
    colors[i3 + 1] = this.baseColors[i3 + 1];
    colors[i3 + 2] = this.baseColors[i3 + 2];

    this.lifetimes[i] = 1.0;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  this.sparkSystem = new THREE.Points(geo, new THREE.PointsMaterial({
    size: CONFIG.particleSize,
    map: particleSprite,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
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

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x000000, 0.002);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
  camera.position.set(0, 0, 150);

  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.autoClearColor = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  var renderScene = new RenderPass(scene, camera);
  var bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CONFIG.bloomStrength, CONFIG.bloomRadius, 0.0
  );
  var vignettePass = new ShaderPass(VignetteShader);
  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
  composer.addPass(vignettePass);
  composer.addPass(new OutputPass());
  composer.bloomPass = bloomPass;

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

  // side:DoubleSide — 카메라가 8자로 계속 움직이며 매 프레임 이 패널을 다시
  // lookAt()하는데, 배치·회전 계산상 앞면(front face)이 우연히 카메라 반대쪽을
  // 향하면 기본 FrontSide 컬링 때문에 이 패널이 안 보여서 잔상(트레일)이 전혀
  // 지워지지 않고, 별·파티클이 계속 가산 블렌딩으로 쌓이기만 하다가 화면이
  // 하얗게 포화되는 문제가 있었다. 양면 렌더링으로 바꿔 항상 보이게 한다.
  var fadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: CONFIG.trailOpacity, side: THREE.DoubleSide
  });
  fullScreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), fadeMaterial);
  fullScreenQuad.position.z = camera.position.z - 50;
  fullScreenQuad.lookAt(camera.position);
  scene.add(fullScreenQuad);

  fireworks = [];
  lastLaunchTime = 0;
  nextLaunchDelay = 0;
  camAngle = 0;
}

var camDirScratch = new THREE.Vector3();
// fullScreenQuad(잔상용 반투명 패널)는 카메라가 고정이던 원본에서는 한 번만
// 배치해도 됐지만, 이제 카메라가 8자로 움직이므로 매 프레임 카메라 앞
// 50유닛 지점으로 따라가며 카메라를 향해 다시 정렬해야 화면 전체를 덮는
// 페이드 효과가 계속 유지된다.
function updateFadeQuad() {
  camera.getWorldDirection(camDirScratch);
  fullScreenQuad.position.copy(camera.position).addScaledVector(camDirScratch, 50);
  fullScreenQuad.lookAt(camera.position);
}

function onResize() {
  if (!renderer || !camera || !composer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.bloomPass.resolution.set(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  rafId = requestAnimationFrame(animate);
  var dt = clock.getDelta();
  updateCameraPath(dt);
  updateFadeQuad();
  updateQueue(performance.now());
  for (var i = fireworks.length - 1; i >= 0; i--) {
    var fw = fireworks[i];
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
    updateFadeQuad();
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
  scene = camera = renderer = composer = canvas = clock = fullScreenQuad = null;
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
