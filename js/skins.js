// 16번 — 스킨 탭. 카탈로그는 서버(functions/src/constants.js SKIN_CATALOG)와 동일하게
// 클라이언트에도 상수로 둔다(표시용 — 실제 가격 검증은 항상 서버가 한다).
var SBM_SKIN_CATALOG = {
  'excel-default': { name: '스프레드시트 테마', category: 'theme', price: 200000 },
  'win11-folder': { name: '탐색기 스타일 테마', category: 'theme', price: 200000 },
  'macos-finder': { name: '트래픽라이트 테마', category: 'theme', price: 200000 },
  'retro-pc': { name: '레트로 PC 테마', category: 'theme', price: 200000 },
  'spring-bloom': { name: '벚꽃 테마', category: 'theme', price: 200000 },
  'summer-ocean': { name: '오션 테마', category: 'theme', price: 200000 },
  'autumn-maple': { name: '단풍 테마', category: 'theme', price: 200000 },
  'winter-snow': { name: '스노우 테마', category: 'theme', price: 200000 },
};

// 관리 탭 — 스킨 구매 내역. RTDB 규칙상 관리자·인증 스트리머만 읽을 수 있는 경로라
// 다른 관리 전용 목록(감사 로그 등)과 동일하게 구독 가드를 둔다.
var sbmSkinPurchaseLogSubscribed = false;
function sbmRenderSkinPurchaseLog() {
  var list = document.getElementById('skin-purchase-log-list');
  if (!list || sbmSkinPurchaseLogSubscribed || !window.sbmFirebase) return;
  sbmSkinPurchaseLogSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/skinPurchases'), function (snap) {
    var val = snap.val() || {};
    var entries = Object.keys(val).map(function (k) { return val[k]; })
      .sort(function (a, b) { return b.purchasedAt - a.purchasedAt; });
    list.innerHTML = entries.length ? entries.map(function (e) {
      return '<li class="verify-req-item"><div class="verify-req-info"><b>' + sbmEscapeHtml(e.nickname || e.uid) + '</b>' +
        '<span>' + sbmEscapeHtml(e.skinName) + ' · ' + Math.round(e.price).toLocaleString('ko-KR') + '원 · ' +
        new Date(e.purchasedAt).toLocaleString('ko-KR') + '</span></div></li>';
    }).join('') : '<li class="audit-empty">구매 내역이 없습니다.</li>';
  });
}

(function () {
  var previewBar = document.getElementById('skin-preview-bar');
  var previewBarName = document.getElementById('skin-preview-bar-name');
  var previewExitBtn = document.getElementById('skin-preview-exit-btn');
  var cards = document.querySelectorAll('.skin-card[data-skin-id]');
  if (!cards.length) return;

  var ownedSkins = {};
  var equippedSkinId = '';
  var previewSkinId = ''; // 미리보기 중인 skinId, 없으면 ''

  // html 태그의 theme-* 클래스만 골라서 교체한다 — 다른 용도의 클래스는 건드리지 않는다.
  function setThemeClass(skinId) {
    var html = document.documentElement;
    var classes = (html.className || '').split(/\s+/).filter(function (c) { return c && c.indexOf('theme-') !== 0; });
    if (skinId) classes.push('theme-' + skinId);
    html.className = classes.join(' ');
    sbmUpdatePetals(skinId === 'spring-bloom');
    sbmUpdatePoolToys(false); // 프레임 드랍 방지 — 다중 장난감 물리는 계속 비활성화
    sbmUpdateWater(skinId === 'summer-ocean');
    sbmUpdateBigTube(skinId === 'summer-ocean');
  }

  // 여름 테마 — 실시간 WebGL 수면 왜곡 셰이더. 정적 CSS 배경(풀장 SVG) 위에
  // 겹쳐서, 그 이미지를 매 프레임 노이즈로 굴절시켜 실제 물처럼 일렁이게 하고
  // 카우스틱(빛 그물무늬) 발광을 더한다. 셰이더 알고리즘(심플렉스 노이즈 기반
  // 표면 왜곡)은 Ksenia Kondrashova의 MIT 라이선스 CodePen
  // (https://codepen.io/ksenia-k/pen/RwXVMMY, "Lightweight Water Distortion
  // Effect")을 원 저작자 표기와 함께 그대로 가져와 이 프로젝트의 풀장 이미지에
  // 맞게 붙였다. WebGL을 지원하지 않는 환경에서는 캔버스가 그려지지 않고
  // 아래 CSS 배경(정적 이미지)이 그대로 보이므로 안전하게 폴백된다.
  var sbmWaterCanvas = null;
  var sbmWaterGL = null;
  var sbmWaterUniforms = null;
  var sbmWaterRAF = null;
  var sbmWaterImage = null;
  var sbmWaterImgRatio = 16 / 9;
  var sbmWaterReducedMotion = false;
  var SBM_WATER_SRC = 'assets/summer-pool.svg';
  var SBM_WATER_PARAMS = { blueish: 0.5, scale: 8, illumination: 0.2, surfaceDistortion: 0.05, waterDistortion: 0.025 };

  var SBM_WATER_VERT_SRC =
    'precision mediump float;' +
    'varying vec2 vUv;' +
    'attribute vec2 a_position;' +
    'void main() {' +
    '  vUv = .5 * (a_position + 1.);' +
    '  gl_Position = vec4(a_position, 0.0, 1.0);' +
    '}';

  var SBM_WATER_FRAG_SRC =
    'precision mediump float;' +
    'varying vec2 vUv;' +
    'uniform sampler2D u_image_texture;' +
    'uniform float u_time;' +
    'uniform float u_ratio;' +
    'uniform float u_img_ratio;' +
    'uniform float u_blueish;' +
    'uniform float u_scale;' +
    'uniform float u_illumination;' +
    'uniform float u_surface_distortion;' +
    'uniform float u_water_distortion;' +
    'vec3 mod289(vec3 x) { return x - floor(x * (1. / 289.)) * 289.; }' +
    'vec2 mod289(vec2 x) { return x - floor(x * (1. / 289.)) * 289.; }' +
    'vec3 permute(vec3 x) { return mod289(((x*34.)+1.)*x); }' +
    'float snoise(vec2 v) {' +
    '  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);' +
    '  vec2 i = floor(v + dot(v, C.yy));' +
    '  vec2 x0 = v - i + dot(i, C.xx);' +
    '  vec2 i1;' +
    '  i1 = (x0.x > x0.y) ? vec2(1., 0.) : vec2(0., 1.);' +
    '  vec4 x12 = x0.xyxy + C.xxzz;' +
    '  x12.xy -= i1;' +
    '  i = mod289(i);' +
    '  vec3 p = permute(permute(i.y + vec3(0., i1.y, 1.)) + i.x + vec3(0., i1.x, 1.));' +
    '  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.);' +
    '  m = m*m; m = m*m;' +
    '  vec3 x = 2. * fract(p * C.www) - 1.;' +
    '  vec3 h = abs(x) - 0.5;' +
    '  vec3 ox = floor(x + 0.5);' +
    '  vec3 a0 = x - ox;' +
    '  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);' +
    '  vec3 g;' +
    '  g.x = a0.x * x0.x + h.x * x0.y;' +
    '  g.yz = a0.yz * x12.xz + h.yz * x12.yw;' +
    '  return 130. * dot(m, g);' +
    '}' +
    'mat2 rotate2D(float r) { return mat2(cos(r), sin(r), -sin(r), cos(r)); }' +
    'float surface_noise(vec2 uv, float t, float scale) {' +
    '  vec2 n = vec2(.1);' +
    '  vec2 N = vec2(.1);' +
    '  mat2 m = rotate2D(.5);' +
    // 프래그먼트 셰이더는 화면의 모든 픽셀마다 이 루프를 도는데, 반복마다 sin/cos를
    // (vec2라 실질 4회) 호출해 프레임 드랍의 주범이었다. 반복 횟수를 10 → 5로 줄여
    // 이 루프의 삼각함수 연산량을 절반으로 낮췄다(scale이 반복마다 1.2배씩 커지는
    // 누적 방식이라, 절반만 돌아도 저주파~중간 주파수 디테일은 거의 그대로 유지된다).
    '  for (int j = 0; j < 5; j++) {' +
    '    uv *= m; n *= m;' +
    '    vec2 q = uv * scale + float(j) + n + (.5 + .5 * float(j)) * (mod(float(j), 2.) - 1.) * t;' +
    '    n += sin(q);' +
    '    N += cos(q) / scale;' +
    '    scale *= 1.2;' +
    '  }' +
    '  return (N.x + N.y + .1);' +
    '}' +
    'void main() {' +
    '  vec2 uv = vUv;' +
    '  uv.y = 1. - uv.y;' +
    '  uv.x *= u_ratio;' +
    '  float t = .002 * u_time;' +
    '  vec3 color = vec3(0.);' +
    '  float opacity = 0.;' +
    '  float outer_noise = snoise((.3 + .1 * sin(t)) * uv + vec2(0., .2 * t));' +
    '  vec2 surface_noise_uv = 2. * uv + (outer_noise * .2);' +
    '  float sn = surface_noise(surface_noise_uv, t, u_scale);' +
    '  sn *= pow(uv.y, .3);' +
    '  sn = pow(sn, 2.);' +
    '  vec2 img_uv = vUv;' +
    '  img_uv -= .5;' +
    '  if (u_ratio > u_img_ratio) { img_uv.x = img_uv.x * u_ratio / u_img_ratio; }' +
    '  else { img_uv.y = img_uv.y * u_img_ratio / u_ratio; }' +
    '  img_uv *= 1.4;' +
    '  img_uv += .5;' +
    '  img_uv.y = 1. - img_uv.y;' +
    '  img_uv += (u_water_distortion * outer_noise);' +
    '  img_uv += (u_surface_distortion * sn);' +
    '  vec4 img = texture2D(u_image_texture, img_uv);' +
    '  img *= (1. + u_illumination * sn);' +
    '  color += img.rgb;' +
    '  color += u_illumination * vec3(1. - u_blueish, 1., 1.) * sn;' +
    // 안개(feTurbulence 애니메이션) 대신, 이미 계산해둔 잔물결 노이즈(sn)를 그대로
    // 재활용해 물결에 의해 빛이 덜 모이는 자리를 풀장 바닥 그림자로 어둡게 한다.
    // sn을 셰이더가 어차피 굴절·발광에 쓰려고 매 프레임 계산하던 값이라 추가
    // 연산 비용이 거의 없고, 별도 애니메이션 텍스처를 계속 다시 그릴 필요도 없다.
    '  float shadow = smoothstep(0.15, 0.0, sn);' +
    '  color -= shadow * (0.3 + u_illumination) * vec3(0.04, 0.12, 0.16);' +
    '  opacity += img.a;' +
    // 원본 데모의 edge_alpha 비네트(액자 속 사진처럼 가장자리를 투명하게 페이드아웃하는
    // 로직)는 제거했다 — 여기선 액자가 아니라 화면 전체가 물이어야 하므로, 가장자리도
    // 중앙과 동일하게 불투명하게 그린다(CLAMP_TO_EDGE라 UV가 [0,1]을 살짝 벗어나도
    // 텍스처 가장자리 색이 자연스럽게 이어진다).
    '  gl_FragColor = vec4(color, opacity);' +
    '}';

  function sbmWaterCompileShader(gl, src, type) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function sbmWaterInitGL(canvas) {
    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    var vs = sbmWaterCompileShader(gl, SBM_WATER_VERT_SRC, gl.VERTEX_SHADER);
    var fs = sbmWaterCompileShader(gl, SBM_WATER_FRAG_SRC, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return null;
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);

    var uniforms = {};
    var uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniformCount; i++) {
      var name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    var vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    var posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(uniforms.u_blueish, SBM_WATER_PARAMS.blueish);
    gl.uniform1f(uniforms.u_scale, SBM_WATER_PARAMS.scale);
    gl.uniform1f(uniforms.u_illumination, SBM_WATER_PARAMS.illumination);
    gl.uniform1f(uniforms.u_surface_distortion, SBM_WATER_PARAMS.surfaceDistortion);
    gl.uniform1f(uniforms.u_water_distortion, SBM_WATER_PARAMS.waterDistortion);

    sbmWaterUniforms = uniforms;
    return gl;
  }

  function sbmWaterResize() {
    if (!sbmWaterCanvas || !sbmWaterGL) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var gl = sbmWaterGL;
    sbmWaterCanvas.width = Math.round(window.innerWidth * dpr);
    sbmWaterCanvas.height = Math.round(window.innerHeight * dpr);
    sbmWaterCanvas.style.width = window.innerWidth + 'px';
    sbmWaterCanvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, sbmWaterCanvas.width, sbmWaterCanvas.height);
    gl.uniform1f(sbmWaterUniforms.u_ratio, sbmWaterCanvas.width / sbmWaterCanvas.height);
    gl.uniform1f(sbmWaterUniforms.u_img_ratio, sbmWaterImgRatio);
  }

  function sbmWaterLoadTexture() {
    var img = new Image();
    img.onload = function () {
      sbmWaterImgRatio = img.naturalWidth / img.naturalHeight || sbmWaterImgRatio;
      var gl = sbmWaterGL;
      if (!gl) return;
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.uniform1i(sbmWaterUniforms.u_image_texture, 0);
      sbmWaterResize();
      if (!sbmWaterReducedMotion && !sbmWaterRAF) sbmWaterRAF = requestAnimationFrame(sbmWaterLoop);
    };
    img.src = SBM_WATER_SRC;
    sbmWaterImage = img;
  }

  function sbmWaterLoop(t) {
    if (!sbmWaterCanvas || !sbmWaterGL) return;
    sbmWaterGL.uniform1f(sbmWaterUniforms.u_time, t);
    sbmWaterGL.drawArrays(sbmWaterGL.TRIANGLE_STRIP, 0, 4);
    sbmWaterRAF = requestAnimationFrame(sbmWaterLoop);
  }

  function sbmUpdateWater(shouldShow) {
    if (!shouldShow) {
      if (sbmWaterRAF) { cancelAnimationFrame(sbmWaterRAF); sbmWaterRAF = null; }
      if (sbmWaterCanvas) { sbmWaterCanvas.remove(); sbmWaterCanvas = null; }
      sbmWaterGL = null;
      sbmWaterUniforms = null;
      sbmWaterImage = null;
      window.removeEventListener('resize', sbmWaterResize);
      return;
    }
    if (sbmWaterCanvas) return; // 이미 떠 있음
    sbmWaterReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (sbmWaterReducedMotion) return; // 정적 CSS 배경만 보여주고 셰이더는 켜지 않는다

    var canvas = document.createElement('canvas');
    canvas.id = 'sbm-water-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var gl = sbmWaterInitGL(canvas);
    if (!gl) { canvas.remove(); return; } // WebGL 미지원 — CSS 정적 배경으로 폴백
    sbmWaterCanvas = canvas;
    sbmWaterGL = gl;
    sbmWaterLoadTexture();
    window.addEventListener('resize', sbmWaterResize);
  }

  // 여름 테마 — 큰 튜브 하나. 예전엔 장난감을 여러 개(최대 22개) 물리 연산 +
  // ctx.filter 블러 그림자로 그려서 프레임 드랍이 있었는데, 이번엔 딱 1개만
  // 그리는 대신 라디얼 그라데이션으로 원환(torus) 단면의 입체감·광택·안쪽
  // 그림자를 살려 디테일을 높였다(ctx.filter 블러 대신 그림자도 저비용
  // 라디얼 그라데이션으로 그려서 개수가 늘어도 안전한 방식을 유지). 마우스에
  // 닿으면 그 반대 방향으로 튕기고, 화면 가장자리에서는 벽처럼 반사된다.
  var sbmTubeCanvas = null;
  var sbmTubeCtx = null;
  var sbmTube = null;
  var sbmTubeRAF = null;
  var sbmTubeLastT = 0;
  var sbmTubeReducedMotion = false;
  var sbmTubeMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var SBM_TUBE_MOUSE_R = 22;

  function sbmTubeSeed() {
    var w = window.innerWidth, h = window.innerHeight;
    var r = Math.max(70, Math.min(150, Math.min(w, h) * 0.11));
    sbmTube = {
      x: w * 0.6, y: h * 0.48,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
      r: r, rot: Math.random() * Math.PI * 2, vr: 0,
      bobPhase: Math.random() * Math.PI * 2
    };
  }

  function sbmTubeResize() {
    if (!sbmTubeCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2); // 저사양 대응 — DPR 상한
    sbmTubeCanvas.width = Math.round(window.innerWidth * dpr);
    sbmTubeCanvas.height = Math.round(window.innerHeight * dpr);
    sbmTubeCanvas.style.width = window.innerWidth + 'px';
    sbmTubeCanvas.style.height = window.innerHeight + 'px';
    sbmTubeCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!sbmTube) sbmTubeSeed();
    // 리사이즈로 화면이 좁아져 튜브가 밖으로 밀려나지 않도록 위치를 안쪽으로 당긴다
    sbmTube.x = Math.min(Math.max(sbmTube.x, sbmTube.r), window.innerWidth - sbmTube.r);
    sbmTube.y = Math.min(Math.max(sbmTube.y, sbmTube.r), window.innerHeight - sbmTube.r);
    sbmTubeDraw(0);
  }

  function sbmTubeTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmTubeMouse.t);
    sbmTubeMouse.vx = (x - sbmTubeMouse.x) / dt * 16.67;
    sbmTubeMouse.vy = (y - sbmTubeMouse.y) / dt * 16.67;
    sbmTubeMouse.x = x;
    sbmTubeMouse.y = y;
    sbmTubeMouse.t = now;
  }
  function sbmTubeOnMouseMove(e) { sbmTubeTrackPointer(e.clientX, e.clientY); }
  function sbmTubeOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmTubeTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmTubeStep(dtFactor) {
    var p = sbmTube;
    if (!p) return;
    var w = window.innerWidth, h = window.innerHeight;
    var mx = sbmTubeMouse.x, my = sbmTubeMouse.y;
    var mouseSpeed = Math.sqrt(sbmTubeMouse.vx * sbmTubeMouse.vx + sbmTubeMouse.vy * sbmTubeMouse.vy);

    var dx = p.x - mx, dy = p.y - my;
    var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    var minDist = p.r + SBM_TUBE_MOUSE_R;
    if (dist < minDist) {
      var nx = dx / dist, ny = dy / dist;
      p.x += nx * (minDist - dist);
      p.y += ny * (minDist - dist);
      var impulse = Math.max(mouseSpeed * 0.7, 6);
      p.vx += nx * impulse;
      p.vy += ny * impulse;
      p.vr += (Math.random() - 0.5) * 0.2;
    }

    // 물 위를 떠도는 잔잔한 표류 + 아주 느린 자체 회전(하이라이트·밸브가 보이도록)
    p.vx += (Math.random() - 0.5) * 0.05;
    p.vy += (Math.random() - 0.5) * 0.05;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.vr *= 0.97;
    p.x += p.vx * dtFactor;
    p.y += p.vy * dtFactor;
    p.rot += p.vr * dtFactor + 0.0009 * dtFactor;

    if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.82; }
    else if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx) * 0.82; }
    if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.82; }
    else if (p.y > h - p.r) { p.y = h - p.r; p.vy = -Math.abs(p.vy) * 0.82; }

    sbmTubeMouse.vx *= 0.85;
    sbmTubeMouse.vy *= 0.85;
  }

  function sbmTubeDraw(tSec) {
    if (!sbmTubeCtx || !sbmTube) return;
    var ctx = sbmTubeCtx, p = sbmTube;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    var bob = Math.sin(tSec * 1.2 + p.bobPhase) * 3;
    var cx = p.x, cy = p.y + bob;
    var outerR = p.r, innerR = p.r * 0.52;

    // 그림자 — ctx.filter 블러 대신 저비용 라디얼 그라데이션으로 부드럽게 표현
    var shGrad = ctx.createRadialGradient(cx + 8, cy + outerR * 0.55, outerR * 0.15, cx + 8, cy + outerR * 0.55, outerR * 1.05);
    shGrad.addColorStop(0, 'rgba(6,40,50,0.38)');
    shGrad.addColorStop(1, 'rgba(6,40,50,0)');
    ctx.fillStyle = shGrad;
    ctx.beginPath();
    ctx.ellipse(cx + 8, cy + outerR * 0.55, outerR * 1.05, outerR * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(p.rot);

    // 튜브 몸체 — 라디얼 그라데이션으로 원환(torus) 단면 입체감(안쪽 그늘 →
    // 하이라이트 능선 → 바깥 그늘) 표현, 가운데는 구멍으로 뚫어 물이 비치게 한다.
    var bodyGrad = ctx.createRadialGradient(0, 0, innerR * 0.75, 0, 0, outerR);
    bodyGrad.addColorStop(0, '#c23b3b');
    bodyGrad.addColorStop(0.38, '#ff8a8a');
    bodyGrad.addColorStop(0.7, '#ff5c5c');
    bodyGrad.addColorStop(1, '#b83030');
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.moveTo(innerR, 0);
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.fill('evenodd');

    // 구멍 안쪽 — 물이 비치는 느낌 + 안쪽 테두리 음영(AO)으로 깊이감
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,110,130,0.55)';
    ctx.fill();
    ctx.lineWidth = innerR * 0.14;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.stroke();

    // 광택 하이라이트(비스듬한 반투명 흰색 — 매끈한 플라스틱 느낌)
    ctx.save();
    ctx.rotate(-0.6);
    ctx.beginPath();
    ctx.ellipse(-outerR * 0.42, -outerR * 0.55, outerR * 0.32, outerR * 0.11, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.restore();

    // 공기 주입구(밸브) 디테일
    ctx.beginPath();
    ctx.ellipse(0, outerR * 0.85, outerR * 0.08, outerR * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#7a2020';
    ctx.fill();

    // 바깥 테두리를 살짝 어둡게 눌러 윤곽을 또렷하게
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();

    ctx.restore();
  }

  function sbmTubeLoop(t) {
    if (!sbmTubeCanvas) return;
    var dtMs = sbmTubeLastT ? (t - sbmTubeLastT) : 16.67;
    sbmTubeLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67);
    sbmTubeStep(dtFactor);
    sbmTubeDraw(t / 1000);
    sbmTubeRAF = requestAnimationFrame(sbmTubeLoop);
  }

  function sbmUpdateBigTube(shouldShow) {
    if (!shouldShow) {
      if (sbmTubeRAF) { cancelAnimationFrame(sbmTubeRAF); sbmTubeRAF = null; }
      if (sbmTubeCanvas) { sbmTubeCanvas.remove(); sbmTubeCanvas = null; sbmTubeCtx = null; }
      window.removeEventListener('mousemove', sbmTubeOnMouseMove);
      window.removeEventListener('touchmove', sbmTubeOnTouchMove);
      window.removeEventListener('resize', sbmTubeResize);
      sbmTube = null;
      sbmTubeLastT = 0;
      return;
    }
    if (sbmTubeCanvas) return; // 이미 떠 있음
    sbmTubeReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmTubeCanvas = document.createElement('canvas');
    sbmTubeCanvas.id = 'sbm-big-tube-layer';
    sbmTubeCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmTubeCanvas);
    sbmTubeCtx = sbmTubeCanvas.getContext('2d');
    sbmTubeResize(); // 크기 지정 + 시딩 + 첫 프레임 렌더

    if (sbmTubeReducedMotion) return; // 정적 배치만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmTubeOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmTubeOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmTubeResize);
    sbmTubeLastT = 0;
    sbmTubeRAF = requestAnimationFrame(sbmTubeLoop);
  }

  // 벚꽃 테마 — 배경 레이어 전체에 이미 두껍게 쌓인 꽃잎 카펫 + 마우스가 지나갈 때
  // 그 자리를 낙엽 치우는 강풍기처럼 쓸어버리는 효과. 개수가 많고(전체 화면을
  // 덮는 밀도) 매 프레임 물리 연산(스프링 복귀 + 감쇠)이 필요해 DOM 엘리먼트
  // 대신 <canvas> 2D 렌더링을 쓴다 — 수백 개의 style 변경보다 캔버스 draw 호출이
  // 훨씬 가볍다. 물리는 경과 시간(dtFactor, 60fps 기준 정규화)으로 적분해
  // 모니터 주사율과 무관하게 같은 속도로 움직인다.
  var sbmPetalCanvas = null;
  var sbmPetalCtx = null;
  var sbmPetalParticles = null;
  var sbmPetalRAF = null;
  var sbmPetalLastT = 0;
  var sbmPetalReducedMotion = false;
  var sbmPetalMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var SBM_PETAL_COLORS = ['#ffd9e8', '#f7b8d1', '#f4a6c6', '#e386ab'];
  var SBM_PETAL_BLOW_RADIUS = 150;

  function sbmPetalSeed() {
    var w = window.innerWidth, h = window.innerHeight;
    var count = Math.min(960, Math.max(180, Math.round((w * h) / 3000))); // 기존 밀도의 3배
    if (w < 640) count = Math.round(count * 0.55); // 모바일에선 더 가볍게
    var particles = [];
    for (var i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h, // 배경 레이어 전체에 골고루 쌓여있는 상태
        vx: 0, vy: 0,
        r: 4 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2,
        vr: 0,
        color: SBM_PETAL_COLORS[(Math.random() * SBM_PETAL_COLORS.length) | 0]
      });
    }
    sbmPetalParticles = particles;
  }

  function sbmPetalResize() {
    if (!sbmPetalCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    sbmPetalCanvas.width = Math.round(window.innerWidth * dpr);
    sbmPetalCanvas.height = Math.round(window.innerHeight * dpr);
    sbmPetalCanvas.style.width = window.innerWidth + 'px';
    sbmPetalCanvas.style.height = window.innerHeight + 'px';
    sbmPetalCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmPetalSeed();
    sbmPetalDraw();
  }

  // 마우스 이동 속도(직전 위치 대비 변위/경과시간)를 추적 — 빠르게 움직일수록
  // "강풍"이 세지고, 멈춰있으면(속도 0에 가까워지면) 꽃잎도 다시 잠잠해진다.
  function sbmPetalTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmPetalMouse.t);
    sbmPetalMouse.vx = (x - sbmPetalMouse.x) / dt * 16.67;
    sbmPetalMouse.vy = (y - sbmPetalMouse.y) / dt * 16.67;
    sbmPetalMouse.x = x;
    sbmPetalMouse.y = y;
    sbmPetalMouse.t = now;
  }
  function sbmPetalOnMouseMove(e) { sbmPetalTrackPointer(e.clientX, e.clientY); }
  function sbmPetalOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmPetalTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmPetalStep(dtFactor) {
    var particles = sbmPetalParticles;
    if (!particles) return;
    var mx = sbmPetalMouse.x, my = sbmPetalMouse.y;
    var speed = Math.sqrt(sbmPetalMouse.vx * sbmPetalMouse.vx + sbmPetalMouse.vy * sbmPetalMouse.vy);
    var blowing = speed > 1.2;
    var w = window.innerWidth, h = window.innerHeight;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (blowing) {
        var dx = p.x - mx, dy = p.y - my;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        if (dist < SBM_PETAL_BLOW_RADIUS) {
          // 마우스 위치에서 바깥쪽(마우스의 반대 방향)으로 밀어내는 힘 — 가까울수록,
          // 마우스가 빠르게 움직일수록 세게 흩날린다(강풍기로 쓸어버리는 느낌).
          var force = (1 - dist / SBM_PETAL_BLOW_RADIUS) * Math.min(speed, 40) * 0.35;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
          p.vr += (Math.random() - 0.5) * 0.15;
        }
      }
      // 제자리로 되돌아오는 스프링 힘 없음 — 밀려난 자리에서 감쇠(공기 저항)로만
      // 서서히 멈춰서고, 다시 원래 쌓여있던 위치로는 돌아가지 않는다.
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.vr *= 0.94;

      p.x += p.vx * dtFactor;
      p.y += p.vy * dtFactor;
      p.rot += p.vr * dtFactor;

      // 화면 밖으로 완전히 날아가 사라지지 않도록 가장자리에서 멈춰 세운다
      if (p.x < 0) { p.x = 0; p.vx = 0; } else if (p.x > w) { p.x = w; p.vx = 0; }
      if (p.y < 0) { p.y = 0; p.vy = 0; } else if (p.y > h) { p.y = h; p.vy = 0; }
    }
    // 마우스가 멈추면 "체감 속도"도 같이 잦아들게 매 프레임 감쇠
    sbmPetalMouse.vx *= 0.85;
    sbmPetalMouse.vy *= 0.85;
  }

  function sbmPetalDraw() {
    if (!sbmPetalCtx || !sbmPetalParticles) return;
    var ctx = sbmPetalCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = 0; i < sbmPetalParticles.length; i++) {
      var p = sbmPetalParticles[i];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function sbmPetalLoop(t) {
    if (!sbmPetalCanvas) return;
    var dtMs = sbmPetalLastT ? (t - sbmPetalLastT) : 16.67;
    sbmPetalLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67); // 탭 전환 복귀 등으로 dt가 튀어도 한 번에 과하게 점프하지 않도록 상한
    sbmPetalStep(dtFactor);
    sbmPetalDraw();
    sbmPetalRAF = requestAnimationFrame(sbmPetalLoop);
  }

  function sbmUpdatePetals(shouldShow) {
    if (!shouldShow) {
      if (sbmPetalRAF) { cancelAnimationFrame(sbmPetalRAF); sbmPetalRAF = null; }
      if (sbmPetalCanvas) { sbmPetalCanvas.remove(); sbmPetalCanvas = null; sbmPetalCtx = null; }
      window.removeEventListener('mousemove', sbmPetalOnMouseMove);
      window.removeEventListener('touchmove', sbmPetalOnTouchMove);
      window.removeEventListener('resize', sbmPetalResize);
      sbmPetalParticles = null;
      sbmPetalLastT = 0;
      return;
    }
    if (sbmPetalCanvas) return; // 이미 떠 있음
    sbmPetalReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmPetalCanvas = document.createElement('canvas');
    sbmPetalCanvas.id = 'sbm-petal-layer';
    sbmPetalCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmPetalCanvas);
    sbmPetalCtx = sbmPetalCanvas.getContext('2d');
    sbmPetalResize(); // 크기 지정 + 화면 전체에 꽃잎 카펫 시딩 + 첫 프레임 렌더

    if (sbmPetalReducedMotion) return; // 정적 카펫만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmPetalOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmPetalOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmPetalResize);
    sbmPetalLastT = 0;
    sbmPetalRAF = requestAnimationFrame(sbmPetalLoop);
  }

  // 여름 테마 — 풀장 탑뷰 배경(assets/summer-pool.svg) 위에 비치볼 · 튜브 · 오리
  // 튜브 등 물놀이 장난감을 캔버스로 띄운다. 마우스가 닿으면(원형 충돌) 그
  // 반대 방향으로 튕겨나가고, 화면 가장자리에 닿으면 벽처럼 반사돼 튕긴다.
  // 물 위에 떠 있는 느낌을 위해 각 장난감 아래에 흐린 그림자(물그림자)를 깔고,
  // 평소엔 잔물결에 살짝씩 흔들리듯 미세한 표류(현재)를 계속 준다.
  var sbmPoolCanvas = null;
  var sbmPoolCtx = null;
  var sbmPoolToys = null;
  var sbmPoolRAF = null;
  var sbmPoolLastT = 0;
  var sbmPoolReducedMotion = false;
  var sbmPoolMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var SBM_POOL_MOUSE_R = 22;
  var SBM_POOL_TYPES = ['ball', 'ring', 'duck', 'star'];
  var SBM_POOL_RING_COLORS = ['#ff6b6b', '#ffd93d', '#4dd6c0', '#5b8def', '#ff9f5b'];

  function sbmPoolSeed() {
    var w = window.innerWidth, h = window.innerHeight;
    var count = Math.min(22, Math.max(8, Math.round((w * h) / 90000)));
    if (w < 640) count = Math.round(count * 0.6);
    var toys = [];
    for (var i = 0; i < count; i++) {
      var type = SBM_POOL_TYPES[(Math.random() * SBM_POOL_TYPES.length) | 0];
      toys.push({
        type: type,
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
        r: type === 'ring' ? (22 + Math.random() * 10) : (16 + Math.random() * 8),
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.01,
        color: SBM_POOL_RING_COLORS[(Math.random() * SBM_POOL_RING_COLORS.length) | 0],
        bobPhase: Math.random() * Math.PI * 2
      });
    }
    sbmPoolToys = toys;
  }

  function sbmPoolResize() {
    if (!sbmPoolCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    sbmPoolCanvas.width = Math.round(window.innerWidth * dpr);
    sbmPoolCanvas.height = Math.round(window.innerHeight * dpr);
    sbmPoolCanvas.style.width = window.innerWidth + 'px';
    sbmPoolCanvas.style.height = window.innerHeight + 'px';
    sbmPoolCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmPoolSeed();
    sbmPoolDraw(0);
  }

  function sbmPoolTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmPoolMouse.t);
    sbmPoolMouse.vx = (x - sbmPoolMouse.x) / dt * 16.67;
    sbmPoolMouse.vy = (y - sbmPoolMouse.y) / dt * 16.67;
    sbmPoolMouse.x = x;
    sbmPoolMouse.y = y;
    sbmPoolMouse.t = now;
  }
  function sbmPoolOnMouseMove(e) { sbmPoolTrackPointer(e.clientX, e.clientY); }
  function sbmPoolOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmPoolTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmPoolStep(dtFactor) {
    var toys = sbmPoolToys;
    if (!toys) return;
    var w = window.innerWidth, h = window.innerHeight;
    var mx = sbmPoolMouse.x, my = sbmPoolMouse.y;
    var mouseSpeed = Math.sqrt(sbmPoolMouse.vx * sbmPoolMouse.vx + sbmPoolMouse.vy * sbmPoolMouse.vy);
    for (var i = 0; i < toys.length; i++) {
      var p = toys[i];

      // 마우스와의 원형 충돌 — 닿는 순간 반대 방향으로 튕겨나간다(마우스 속도가
      // 빠를수록 더 세게). 겹친 만큼 위치도 즉시 밀어내 계속 붙어있지 않게 한다.
      var dx = p.x - mx, dy = p.y - my;
      var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      var minDist = p.r + SBM_POOL_MOUSE_R;
      if (dist < minDist) {
        var nx = dx / dist, ny = dy / dist;
        p.x += nx * (minDist - dist);
        p.y += ny * (minDist - dist);
        var impulse = Math.max(mouseSpeed * 0.7, 5);
        p.vx += nx * impulse;
        p.vy += ny * impulse;
        p.vr += (Math.random() - 0.5) * 0.25;
      }

      // 물 위를 떠도는 잔잔한 현(전류) — 완전히 멈추지 않고 계속 미세하게 표류
      p.vx += (Math.random() - 0.5) * 0.06;
      p.vy += (Math.random() - 0.5) * 0.06;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.vr *= 0.96;

      p.x += p.vx * dtFactor;
      p.y += p.vy * dtFactor;
      p.rot += p.vr * dtFactor;

      // 화면 가장자리 = 벽 — 반사(반발계수 0.8)돼 튕기고 밖으로 나가지 않는다
      if (p.x < p.r) { p.x = p.r; p.vx = Math.abs(p.vx) * 0.8; }
      else if (p.x > w - p.r) { p.x = w - p.r; p.vx = -Math.abs(p.vx) * 0.8; }
      if (p.y < p.r) { p.y = p.r; p.vy = Math.abs(p.vy) * 0.8; }
      else if (p.y > h - p.r) { p.y = h - p.r; p.vy = -Math.abs(p.vy) * 0.8; }
    }
    sbmPoolMouse.vx *= 0.85;
    sbmPoolMouse.vy *= 0.85;
  }

  function sbmPoolDrawToy(ctx, p, bob) {
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(p.rot);
    if (p.type === 'ball') {
      var slices = 6;
      for (var s = 0; s < slices; s++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, p.r, (s / slices) * Math.PI * 2, ((s + 1) / slices) * Math.PI * 2);
        ctx.closePath();
        ctx.fillStyle = s % 2 === 0 ? p.color : '#ffffff';
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    } else if (p.type === 'ring') {
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, p.r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(159,230,240,0.85)';
      ctx.fill();
    } else if (p.type === 'duck') {
      ctx.beginPath();
      ctx.ellipse(0, 2, p.r, p.r * 0.72, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd93d';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.r * 0.7, -p.r * 0.35, p.r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#ffd93d';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.r * 1.05, -p.r * 0.35);
      ctx.lineTo(p.r * 1.4, -p.r * 0.22);
      ctx.lineTo(p.r * 1.05, -p.r * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#ff9f2f';
      ctx.fill();
    } else { // star
      var spikes = 5, outerR = p.r, innerR = p.r * 0.48;
      ctx.beginPath();
      for (var k = 0; k < spikes * 2; k++) {
        var rad = k % 2 === 0 ? outerR : innerR;
        var ang = (k / (spikes * 2)) * Math.PI * 2;
        var px = Math.cos(ang) * rad, py = Math.sin(ang) * rad;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.restore();
  }

  function sbmPoolDraw(tSec) {
    if (!sbmPoolCtx || !sbmPoolToys) return;
    var ctx = sbmPoolCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = 0; i < sbmPoolToys.length; i++) {
      var p = sbmPoolToys[i];
      var bob = Math.sin(tSec * 1.6 + p.bobPhase) * 2.5;
      // 물 위에 뜬 느낌을 주는 흐린 그림자(수면 아래 그림자)
      ctx.save();
      ctx.filter = 'blur(4px)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob + p.r * 0.35, p.r * 0.9, p.r * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10,60,70,0.28)';
      ctx.fill();
      ctx.restore();

      sbmPoolDrawToy(ctx, p, bob);
    }
  }

  function sbmPoolLoop(t) {
    if (!sbmPoolCanvas) return;
    var dtMs = sbmPoolLastT ? (t - sbmPoolLastT) : 16.67;
    sbmPoolLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67);
    sbmPoolStep(dtFactor);
    sbmPoolDraw(t / 1000);
    sbmPoolRAF = requestAnimationFrame(sbmPoolLoop);
  }

  function sbmUpdatePoolToys(shouldShow) {
    if (!shouldShow) {
      if (sbmPoolRAF) { cancelAnimationFrame(sbmPoolRAF); sbmPoolRAF = null; }
      if (sbmPoolCanvas) { sbmPoolCanvas.remove(); sbmPoolCanvas = null; sbmPoolCtx = null; }
      window.removeEventListener('mousemove', sbmPoolOnMouseMove);
      window.removeEventListener('touchmove', sbmPoolOnTouchMove);
      window.removeEventListener('resize', sbmPoolResize);
      sbmPoolToys = null;
      sbmPoolLastT = 0;
      return;
    }
    if (sbmPoolCanvas) return; // 이미 떠 있음
    sbmPoolReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmPoolCanvas = document.createElement('canvas');
    sbmPoolCanvas.id = 'sbm-pool-toys-layer';
    sbmPoolCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmPoolCanvas);
    sbmPoolCtx = sbmPoolCanvas.getContext('2d');
    sbmPoolResize(); // 크기 지정 + 장난감 시딩 + 첫 프레임 렌더

    if (sbmPoolReducedMotion) return; // 정적 배치만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmPoolOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmPoolOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmPoolResize);
    sbmPoolLastT = 0;
    sbmPoolRAF = requestAnimationFrame(sbmPoolLoop);
  }

  function applyEquippedTheme() {
    if (previewSkinId) return; // 미리보기 중엔 실제 장착 테마로 되돌리지 않는다
    setThemeClass(equippedSkinId);
  }

  function startPreview(skinId) {
    previewSkinId = skinId;
    setThemeClass(skinId);
    if (previewBarName) previewBarName.textContent = (SBM_SKIN_CATALOG[skinId] || {}).name || skinId;
    if (previewBar) previewBar.style.display = '';
  }
  function exitPreview() {
    if (!previewSkinId) return;
    previewSkinId = '';
    setThemeClass(equippedSkinId);
    if (previewBar) previewBar.style.display = 'none';
  }
  if (previewExitBtn) previewExitBtn.addEventListener('click', exitPreview);

  function renderSkinCards() {
    cards.forEach(function (card) {
      var skinId = card.getAttribute('data-skin-id');
      var owned = !!ownedSkins[skinId];
      var equipped = equippedSkinId === skinId;
      card.classList.toggle('owned', owned && !equipped);
      card.classList.toggle('equipped', equipped);
      var buyBtn = card.querySelector('.skin-buy-btn');
      if (!buyBtn) return;
      buyBtn.classList.toggle('owned', owned && !equipped);
      buyBtn.classList.toggle('equipped', equipped);
      buyBtn.textContent = equipped ? '해제하기' : (owned ? '장착하기' : '구매하기');
    });
  }

  cards.forEach(function (card) {
    var skinId = card.getAttribute('data-skin-id');
    var skin = SBM_SKIN_CATALOG[skinId];
    var buyBtn = card.querySelector('.skin-buy-btn');
    var previewBtn = card.querySelector('.skin-preview-btn');

    if (previewBtn) {
      previewBtn.addEventListener('click', function () { startPreview(skinId); });
    }

    if (buyBtn) {
      buyBtn.addEventListener('click', function () {
        if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
        if (!window.sbmFirebase) return;
        var owned = !!ownedSkins[skinId];
        var equipped = equippedSkinId === skinId;
        var fnName, payload;
        if (equipped) {
          fnName = 'equipSkin';
          payload = { skinId: null };
        } else if (owned) {
          fnName = 'equipSkin';
          payload = { skinId: skinId };
        } else {
          var price = (skin && skin.price) || 0;
          if (!confirm((skin ? skin.name : skinId) + '을(를) ' + price.toLocaleString('ko-KR') + '원에 구매할까요?')) return;
          fnName = 'purchaseSkin';
          payload = { skinId: skinId };
        }
        buyBtn.disabled = true;
        window.sbmFirebase.httpsCallable(fnName)(payload)
          .catch(function (e) { alert(e.message); })
          .then(function () { buyBtn.disabled = false; });
      });
    }
  });

  // 시범 공개 중인 관리자 전용 스킨(예: 계절 테마 4종) — 관리자가 아니면 카테고리
  // 필터 조작과 무관하게 항상 숨겨야 하므로, style.display가 아니라 별도 클래스로
  // 게이팅한다(CSS 쪽 .skin-card[data-admin-only] 규칙 참고).
  function updateAdminOnlyCards() {
    var isAdmin = !!window.sbmIsAdmin;
    cards.forEach(function (card) {
      if (card.hasAttribute('data-admin-only')) {
        card.classList.toggle('sbm-admin-visible', isAdmin);
      }
    });
  }

  var unsubscribeOwned = null;
  var unsubscribeEquipped = null;
  document.addEventListener('sbm-auth-changed', function (e) {
    updateAdminOnlyCards();
    if (unsubscribeOwned) { unsubscribeOwned(); unsubscribeOwned = null; }
    if (unsubscribeEquipped) { unsubscribeEquipped(); unsubscribeEquipped = null; }
    var user = e.detail.user;
    ownedSkins = {};
    equippedSkinId = '';
    exitPreview();
    renderSkinCards();
    if (!user || !window.sbmFirebase) { setThemeClass(''); return; }

    var fb = window.sbmFirebase;
    unsubscribeOwned = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/ownedSkins/' + user.uid), function (snap) {
      ownedSkins = snap.val() || {};
      renderSkinCards();
    });
    unsubscribeEquipped = fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/equippedSkin/' + user.uid), function (snap) {
      equippedSkinId = snap.val() || '';
      renderSkinCards();
      applyEquippedTheme();
    });
  });
})();
