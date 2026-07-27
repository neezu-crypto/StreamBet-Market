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
  volume: 0.5
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

  var renderScene = new RenderPass(scene, camera);
  var bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CONFIG.bloomStrength, CONFIG.bloomRadius, 0.0
  );
  composer = new EffectComposer(renderer);
  composer.addPass(renderScene);
  composer.addPass(bloomPass);
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

  var fadeMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: CONFIG.trailOpacity
  });
  fullScreenQuad = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), fadeMaterial);
  fullScreenQuad.position.z = camera.position.z - 50;
  fullScreenQuad.lookAt(camera.position);
  scene.add(fullScreenQuad);

  fireworks = [];
  lastLaunchTime = 0;
  nextLaunchDelay = 0;
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
