// 16번 — 스킨 탭. 카탈로그는 서버(functions/src/constants.js SKIN_CATALOG)와 동일하게
// 클라이언트에도 상수로 둔다(표시용 — 실제 가격 검증은 항상 서버가 한다).
var SBM_SKIN_CATALOG = {
  'excel-default': { name: '스프레드시트 테마', category: 'theme', price: 150000 },
  'win11-folder': { name: '탐색기 스타일 테마', category: 'theme', price: 150000 },
  'macos-finder': { name: '트래픽라이트 테마', category: 'theme', price: 150000 },
  'retro-pc': { name: '레트로 PC 테마', category: 'theme', price: 150000 },
  'spring-bloom': { name: '벚꽃 테마', category: 'theme', price: 200000 },
  'summer-ocean': { name: '오션 테마', category: 'theme', price: 200000 },
  'autumn-maple': { name: '단풍 테마', category: 'theme', price: 200000 },
  'winter-snow': { name: '스노우 테마', category: 'theme', price: 200000 },
  'trading-terminal': { name: '트레이딩 터미널 테마', category: 'theme', price: 200000 },
  'billiard-table': { name: '당구대 테마', category: 'theme', price: 200000 },
  'firework-market': { name: '불꽃놀이 야시장 테마', category: 'theme', price: 200000 },
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
    sbmUpdateLeaves(skinId === 'autumn-maple');
    sbmUpdateSnow(false); // 3D 회전 숲 배경(js/winter-scene.js)으로 교체 — 발자국 셰이더는 비활성화(코드는 남겨둠)
    sbmUpdateCandleChart(skinId === 'trading-terminal');
    sbmUpdateBilliards(skinId === 'billiard-table');
    sbmUpdateFireworks(skinId === 'firework-market');
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
  var sbmWaterImgRatio = 16 / 9;
  var sbmWaterReducedMotion = false;
  var SBM_WATER_PARAMS = { blueish: 0.5, scale: 8, illumination: 0.2, surfaceDistortion: 0.05, waterDistortion: 0.025 };

  // 셰이더가 굴절시키는 "원본 이미지"를 정적 파일이 아니라, 매 프레임 다시 그리는
  // 작은 2D 캔버스로 바꿨다 — 단색 배경 위에 큰 튜브의 그림자를 그 프레임의 튜브
  // 위치에 맞춰 얹은 뒤 이걸 텍스처로 올리면, 셰이더의 굴절·왜곡이 그림자에도
  // 그대로 적용된다("그림자가 물살에 따라 왜곡"되는 효과). 화면 해상도와 무관하게
  // 작은 고정 폭(SBM_WATER_TEX_W)만 쓰므로 매 프레임 다시 그려도 비용이 적다.
  var sbmWaterTexCanvas = null;
  var sbmWaterTexCtx = null;
  var sbmWaterTex = null;
  var SBM_WATER_TEX_W = 512;
  var SBM_WATER_BASE_COLOR = '#1fa3bc';

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

    // 텍스처 캔버스를 항상 화면 비율과 똑같이 맞춘다 — u_ratio === u_img_ratio가
    // 항상 성립해야 아래 sbmWaterUpdateTexture()의 화면→텍스처 좌표 변환 공식이
    // (셰이더의 img_uv 계산과 어긋나지 않고) 정확하게 들어맞는다.
    if (!sbmWaterTexCanvas) {
      sbmWaterTexCanvas = document.createElement('canvas');
      sbmWaterTexCtx = sbmWaterTexCanvas.getContext('2d');
    }
    var texW = SBM_WATER_TEX_W;
    var texH = Math.max(1, Math.round(texW * (window.innerHeight / window.innerWidth)));
    sbmWaterTexCanvas.width = texW;
    sbmWaterTexCanvas.height = texH;
    sbmWaterImgRatio = texW / texH;
    gl.uniform1f(sbmWaterUniforms.u_img_ratio, sbmWaterImgRatio);

    if (!sbmWaterTex) {
      sbmWaterTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sbmWaterTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(sbmWaterUniforms.u_image_texture, 0);
    }
  }

  // 매 프레임 텍스처를 다시 그린다 — 단색 배경 위에, 큰 튜브가 떠 있으면 그
  // 화면 위치를 셰이더의 img_uv 공식(사방 1.4배 확대 + Y축 반전)대로 그대로
  // 역산해 텍스처 좌표로 옮긴 뒤 그림자를 얹는다. 이 텍스처를 셰이더가 매
  // 프레임 굴절시키므로, 그림자도 물결을 따라 함께 일렁인다.
  function sbmWaterUpdateTexture(tSec) {
    if (!sbmWaterTexCtx || !sbmWaterGL) return;
    var ctx = sbmWaterTexCtx;
    var tw = sbmWaterTexCanvas.width, th = sbmWaterTexCanvas.height;
    ctx.fillStyle = SBM_WATER_BASE_COLOR;
    ctx.fillRect(0, 0, tw, th);

    if (sbmTube) {
      var p = sbmTube;
      var w = window.innerWidth, h = window.innerHeight;
      var bob = Math.sin(tSec * 1.2 + p.bobPhase) * 3;
      var imgUvX = 0.5 + 1.4 * (p.x / w - 0.5);
      var imgUvY = -0.2 + 1.4 * ((p.y + bob) / h);
      var texX = imgUvX * tw;
      var texY = imgUvY * th;
      var texR = (p.r / w) * tw / 1.4;

      var shGrad = ctx.createRadialGradient(texX, texY, texR * 0.15, texX, texY, texR * 1.05);
      shGrad.addColorStop(0, 'rgba(4,30,38,0.5)');
      shGrad.addColorStop(1, 'rgba(4,30,38,0)');
      ctx.fillStyle = shGrad;
      ctx.beginPath();
      ctx.ellipse(texX, texY, texR * 1.05, texR * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    var gl = sbmWaterGL;
    gl.bindTexture(gl.TEXTURE_2D, sbmWaterTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sbmWaterTexCanvas);
  }

  function sbmWaterLoop(t) {
    if (!sbmWaterCanvas || !sbmWaterGL) return;
    sbmWaterUpdateTexture(t / 1000);
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
      sbmWaterTex = null;
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
    sbmWaterResize(); // 텍스처 캔버스까지 함께 초기화
    window.addEventListener('resize', sbmWaterResize);
    sbmWaterRAF = requestAnimationFrame(sbmWaterLoop);
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
    // 그림자는 이 캔버스가 아니라 sbmWaterUpdateTexture()에서, 셰이더가 굴절시키는
    // 텍스처 위에 직접 그린다 — 그래야 물결 왜곡이 그림자에도 그대로 적용된다.

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

  // 가을 테마 — 위에서 계속 낙엽이 떨어져 바닥에 쌓이고(화면을 여러 구간으로
  // 나눠 구간별 더미 높이를 추적), 마우스가 지나가면 강풍기처럼 반대 방향으로
  // 흩날린다. 세게 밀려 화면 밖으로 나가면 그 낙엽은 사라지고, 개수 상한 이하로
  // 유지되는 동안 위에서 계속 보충 생성된다. 물리는 경과 시간(dtFactor, 60fps
  // 기준 정규화)으로 적분해 모니터 주사율과 무관하게 같은 속도로 움직인다.
  var sbmLeafCanvas = null;
  var sbmLeafCtx = null;
  var sbmLeaves = null;
  var sbmLeafPileHeights = null;
  var sbmLeafRAF = null;
  var sbmLeafLastT = 0;
  var sbmLeafWindPhase = 0;
  var sbmLeafReducedMotion = false;
  var sbmLeafMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var SBM_LEAF_FALL_CAP = 55; // 동시에 "떨어지는 중"인 낙엽 수 상한 — 쌓인 낙엽과는 별개로 세서, 바닥이 다 쌓여도 새로 떨어지는 낙엽이 끊이지 않는다
  var SBM_LEAF_BUCKETS = 48;
  var sbmLeafPileMaxPx = 700; // 리사이즈 때 화면 높이에 맞춰 다시 계산됨(sbmLeafReset)
  var SBM_LEAF_BLOW_RADIUS = 140;
  var SBM_LEAF_COLORS = ['#c0522a', '#d97742', '#e0a339', '#a8471b', '#8f6b18'];

  function sbmLeafBucketWidth() { return window.innerWidth / SBM_LEAF_BUCKETS; }

  function sbmLeafSpawn() {
    var size = 6 + Math.random() * 5;
    return {
      x: Math.random() * window.innerWidth,
      y: -20,
      vx: (Math.random() - 0.5) * 0.6,
      vy: 1.2 + Math.random() * 0.8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.05,
      size: size,
      color: SBM_LEAF_COLORS[(Math.random() * SBM_LEAF_COLORS.length) | 0],
      state: 'falling',
      bucket: -1
    };
  }

  function sbmLeafReset() {
    sbmLeafPileMaxPx = Math.round(window.innerHeight * 0.85); // 화면 높이의 85%까지는 계속 쌓일 수 있게 넉넉히 잡는다
    sbmLeafPileHeights = new Array(SBM_LEAF_BUCKETS).fill(0);
    sbmLeaves = [];
    // 처음부터 화면이 텅 비어있지 않도록, 이미 어느 정도 떨어지고 있는 상태로 시작한다
    var initialCount = window.innerWidth < 640 ? 40 : 80;
    for (var i = 0; i < initialCount; i++) {
      var leaf = sbmLeafSpawn();
      leaf.y = Math.random() * window.innerHeight;
      sbmLeaves.push(leaf);
    }
  }

  function sbmLeafResize() {
    if (!sbmLeafCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sbmLeafCanvas.width = Math.round(window.innerWidth * dpr);
    sbmLeafCanvas.height = Math.round(window.innerHeight * dpr);
    sbmLeafCanvas.style.width = window.innerWidth + 'px';
    sbmLeafCanvas.style.height = window.innerHeight + 'px';
    sbmLeafCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmLeafReset();
    sbmLeafDraw();
  }

  function sbmLeafTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmLeafMouse.t);
    sbmLeafMouse.vx = (x - sbmLeafMouse.x) / dt * 16.67;
    sbmLeafMouse.vy = (y - sbmLeafMouse.y) / dt * 16.67;
    sbmLeafMouse.x = x;
    sbmLeafMouse.y = y;
    sbmLeafMouse.t = now;
  }
  function sbmLeafOnMouseMove(e) { sbmLeafTrackPointer(e.clientX, e.clientY); }
  function sbmLeafOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmLeafTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmLeafStep(dtFactor) {
    if (!sbmLeaves) return;
    var w = window.innerWidth, h = window.innerHeight;
    var bw = sbmLeafBucketWidth();
    sbmLeafWindPhase += 0.006 * dtFactor;
    var wind = Math.sin(sbmLeafWindPhase) * 0.35; // 좌우로 서서히 바뀌는 바람

    var mx = sbmLeafMouse.x, my = sbmLeafMouse.y;
    var mouseSpeed = Math.sqrt(sbmLeafMouse.vx * sbmLeafMouse.vx + sbmLeafMouse.vy * sbmLeafMouse.vy);
    var blowing = mouseSpeed > 1.2;

    var next = [];
    var fallingCount = 0;
    for (var i = 0; i < sbmLeaves.length; i++) {
      var leaf = sbmLeaves[i];

      if (blowing) {
        var dx = leaf.x - mx, dy = leaf.y - my;
        var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
        if (dist < SBM_LEAF_BLOW_RADIUS) {
          if (leaf.state === 'settled' && leaf.bucket >= 0) {
            sbmLeafPileHeights[leaf.bucket] = Math.max(0, sbmLeafPileHeights[leaf.bucket] - leaf.size * 0.5);
          }
          leaf.state = 'falling';
          var nx = dx / dist, ny = dy / dist;
          var force = (1 - dist / SBM_LEAF_BLOW_RADIUS) * Math.min(mouseSpeed, 40) * 0.4;
          leaf.vx += nx * force;
          leaf.vy += ny * force;
          leaf.vr += (Math.random() - 0.5) * 0.3;
        }
      }

      if (leaf.state === 'falling') {
        leaf.vx += (wind - leaf.vx) * 0.02 * dtFactor;
        leaf.vx += (Math.random() - 0.5) * 0.04;
        leaf.vy += (1.6 - leaf.vy) * 0.01 * dtFactor; // 목표 낙하 속도로 서서히 수렴
        leaf.vx *= 0.995;
        leaf.vy *= 0.995;
        leaf.x += leaf.vx * dtFactor;
        leaf.y += leaf.vy * dtFactor;
        leaf.rot += leaf.vr * dtFactor;

        var bucket = Math.min(SBM_LEAF_BUCKETS - 1, Math.max(0, Math.floor(leaf.x / bw)));
        var groundY = h - sbmLeafPileHeights[bucket];
        if (leaf.y >= groundY && leaf.vy >= 0) {
          leaf.state = 'settled';
          leaf.y = groundY;
          leaf.vx = 0; leaf.vy = 0; leaf.vr *= 0.3;
          leaf.bucket = bucket;
          sbmLeafPileHeights[bucket] = Math.min(sbmLeafPileMaxPx, sbmLeafPileHeights[bucket] + leaf.size * 0.5);
        }
      }

      // 화면 밖(좌우 또는 위)으로 완전히 밀려나면 사라진다
      if (leaf.x < -40 || leaf.x > w + 40 || leaf.y < -60) {
        if (leaf.state === 'settled' && leaf.bucket >= 0) {
          sbmLeafPileHeights[leaf.bucket] = Math.max(0, sbmLeafPileHeights[leaf.bucket] - leaf.size * 0.5);
        }
        continue; // 배열에서 제외(= 삭제)
      }
      if (leaf.state === 'falling') fallingCount++;
      next.push(leaf);
    }

    // 위에서 계속 보충 생성 — "떨어지는 중"인 낙엽 수만 기준으로 삼는다. 바닥에
    // 쌓인 낙엽은 마우스로 직접 흩날리기 전까지는 치우지 않고 계속 쌓이게 둔다.
    if (fallingCount < SBM_LEAF_FALL_CAP && Math.random() < 0.6 * dtFactor) {
      next.push(sbmLeafSpawn());
    }

    sbmLeaves = next;
    sbmLeafMouse.vx *= 0.85;
    sbmLeafMouse.vy *= 0.85;
  }

  function sbmLeafDraw() {
    if (!sbmLeafCtx || !sbmLeaves) return;
    var ctx = sbmLeafCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = 0; i < sbmLeaves.length; i++) {
      var leaf = sbmLeaves[i];
      ctx.save();
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.rot);
      ctx.fillStyle = leaf.color;
      ctx.beginPath();
      ctx.ellipse(0, 0, leaf.size, leaf.size * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function sbmLeafLoop(t) {
    if (!sbmLeafCanvas) return;
    var dtMs = sbmLeafLastT ? (t - sbmLeafLastT) : 16.67;
    sbmLeafLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67);
    sbmLeafStep(dtFactor);
    sbmLeafDraw();
    sbmLeafRAF = requestAnimationFrame(sbmLeafLoop);
  }

  function sbmUpdateLeaves(shouldShow) {
    if (!shouldShow) {
      if (sbmLeafRAF) { cancelAnimationFrame(sbmLeafRAF); sbmLeafRAF = null; }
      if (sbmLeafCanvas) { sbmLeafCanvas.remove(); sbmLeafCanvas = null; sbmLeafCtx = null; }
      window.removeEventListener('mousemove', sbmLeafOnMouseMove);
      window.removeEventListener('touchmove', sbmLeafOnTouchMove);
      window.removeEventListener('resize', sbmLeafResize);
      sbmLeaves = null;
      sbmLeafPileHeights = null;
      sbmLeafLastT = 0;
      return;
    }
    if (sbmLeafCanvas) return; // 이미 떠 있음
    sbmLeafReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmLeafCanvas = document.createElement('canvas');
    sbmLeafCanvas.id = 'sbm-leaf-layer';
    sbmLeafCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmLeafCanvas);
    sbmLeafCtx = sbmLeafCanvas.getContext('2d');
    sbmLeafResize(); // 크기 지정 + 초기 낙엽 시딩 + 첫 프레임 렌더

    if (sbmLeafReducedMotion) return; // 정적 배치만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmLeafOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmLeafOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmLeafResize);
    sbmLeafLastT = 0;
    sbmLeafRAF = requestAnimationFrame(sbmLeafLoop);
  }

  // 겨울 테마 — 실시간 WebGL 눈밭 셰이더. 마우스가 지나간 자리를 높이맵
  // 텍스처에 "찍어서"(radial gradient + globalCompositeOperation:'lighten'로
  // 같은 자리를 반복해서 지나가도 자연스럽게 최대치까지만 눌리게) 영구히
  // 남기고, 프래그먼트 셰이더가 그 높이맵의 경사(주변 텍셀과의 차이)를
  // 노멀처럼 써서 음영을 계산해 실제로 눌려서 움푹 들어간 것처럼 보이게 한다.
  // 참고한 CodePen("A man walking on snow", Den, MIT — 원 개념은 Codrops의
  // React Three Fiber 지형 변형 데모)은 3D 메시 지형이지만, 이 프로젝트는
  // React·3D 엔진을 안 쓰므로 같은 "높이맵에 눌러서 남기고 그 경사로 음영을
  // 낸다"는 핵심 아이디어만 2D 텍스처 + 셰이더 노멀 셰이딩으로 재구현했다.
  // 걷는 사람 캐릭터는 요청대로 구현하지 않는다.
  var sbmSnowCanvas = null;
  var sbmSnowGL = null;
  var sbmSnowUniforms = null;
  var sbmSnowRAF = null;
  var sbmSnowReducedMotion = false;
  var sbmSnowTexCanvas = null;
  var sbmSnowTexCtx = null;
  var sbmSnowTex = null;
  var sbmSnowTexDirty = true;
  var sbmSnowLastPointer = null; // 텍스처 좌표계, 스탬프 사이 간격 보간용
  var SBM_SNOW_TEX_W = 480;

  var SBM_SNOW_FRAG_SRC =
    'precision mediump float;' +
    'varying vec2 vUv;' +
    'uniform sampler2D u_snow_tex;' +
    'uniform float u_texel_x;' +
    'uniform float u_texel_y;' +
    'void main() {' +
    '  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);' +
    '  float d  = texture2D(u_snow_tex, uv).r;' +
    '  float dl = texture2D(u_snow_tex, uv - vec2(u_texel_x, 0.0)).r;' +
    '  float dr = texture2D(u_snow_tex, uv + vec2(u_texel_x, 0.0)).r;' +
    '  float dt = texture2D(u_snow_tex, uv - vec2(0.0, u_texel_y)).r;' +
    '  float db = texture2D(u_snow_tex, uv + vec2(0.0, u_texel_y)).r;' +
    '  vec2 slope = vec2(dr - dl, db - dt);' +
    '  vec3 lightDir = normalize(vec3(-0.5, -0.6, 0.6));' +
    '  vec3 normal = normalize(vec3(-slope.x * 6.0, -slope.y * 6.0, 1.0));' +
    '  float shade = dot(normal, lightDir);' +
    '  vec3 base = mix(vec3(0.97, 0.98, 1.0), vec3(0.80, 0.85, 0.93), d);' +
    '  vec3 color = base + shade * 0.28;' +
    '  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);' +
    '}';

  function sbmSnowInitGL(canvas) {
    var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return null;
    var vs = sbmWaterCompileShader(gl, SBM_WATER_VERT_SRC, gl.VERTEX_SHADER); // 정점 셰이더는 여름 수면 효과와 동일해 재사용
    var fs = sbmWaterCompileShader(gl, SBM_SNOW_FRAG_SRC, gl.FRAGMENT_SHADER);
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

    sbmSnowUniforms = uniforms;
    return gl;
  }

  function sbmSnowResize() {
    if (!sbmSnowCanvas || !sbmSnowGL) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var gl = sbmSnowGL;
    sbmSnowCanvas.width = Math.round(window.innerWidth * dpr);
    sbmSnowCanvas.height = Math.round(window.innerHeight * dpr);
    sbmSnowCanvas.style.width = window.innerWidth + 'px';
    sbmSnowCanvas.style.height = window.innerHeight + 'px';
    gl.viewport(0, 0, sbmSnowCanvas.width, sbmSnowCanvas.height);

    // 높이맵 텍스처는 화면 해상도와 무관한 작은 고정 폭만 쓴다(발자국은 부드러운
    // 얼룩이라 이 정도 해상도로 충분하고, 매번 다시 만들면 찍힌 자국이 사라지므로
    // 최초 1회만 생성한다).
    if (!sbmSnowTexCanvas) {
      sbmSnowTexCanvas = document.createElement('canvas');
      sbmSnowTexCanvas.width = SBM_SNOW_TEX_W;
      sbmSnowTexCanvas.height = Math.max(1, Math.round(SBM_SNOW_TEX_W * (window.innerHeight / window.innerWidth)));
      sbmSnowTexCtx = sbmSnowTexCanvas.getContext('2d');
      sbmSnowTexCtx.fillStyle = '#000000';
      sbmSnowTexCtx.fillRect(0, 0, sbmSnowTexCanvas.width, sbmSnowTexCanvas.height);
      sbmSnowTexCtx.globalCompositeOperation = 'lighten';
    }
    gl.uniform1f(sbmSnowUniforms.u_texel_x, 1 / sbmSnowTexCanvas.width);
    gl.uniform1f(sbmSnowUniforms.u_texel_y, 1 / sbmSnowTexCanvas.height);

    if (!sbmSnowTex) {
      sbmSnowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sbmSnowTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.uniform1i(sbmSnowUniforms.u_snow_tex, 0);
    }
    sbmSnowTexDirty = true;
  }

  function sbmSnowStampAt(tx, ty) {
    var ctx = sbmSnowTexCtx;
    var r = 15;
    var grad = ctx.createRadialGradient(tx, ty, 0, tx, ty, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(tx, ty, r, 0, Math.PI * 2);
    ctx.fill();
    sbmSnowTexDirty = true;
  }

  function sbmSnowOnPointerMove(x, y) {
    if (!sbmSnowTexCtx) return;
    var texW = sbmSnowTexCanvas.width, texH = sbmSnowTexCanvas.height;
    var tx = (x / window.innerWidth) * texW;
    var ty = (y / window.innerHeight) * texH;
    if (sbmSnowLastPointer) {
      var dx = tx - sbmSnowLastPointer.x, dy = ty - sbmSnowLastPointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var steps = Math.min(30, Math.max(1, Math.floor(dist / 4)));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        sbmSnowStampAt(sbmSnowLastPointer.x + dx * t, sbmSnowLastPointer.y + dy * t);
      }
    } else {
      sbmSnowStampAt(tx, ty);
    }
    sbmSnowLastPointer = { x: tx, y: ty };
  }
  function sbmSnowOnMouseMove(e) { sbmSnowOnPointerMove(e.clientX, e.clientY); }
  function sbmSnowOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmSnowOnPointerMove(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmSnowLoop() {
    if (!sbmSnowCanvas || !sbmSnowGL) return;
    if (sbmSnowTexDirty) {
      sbmSnowGL.bindTexture(sbmSnowGL.TEXTURE_2D, sbmSnowTex);
      sbmSnowGL.texImage2D(sbmSnowGL.TEXTURE_2D, 0, sbmSnowGL.RGBA, sbmSnowGL.RGBA, sbmSnowGL.UNSIGNED_BYTE, sbmSnowTexCanvas);
      sbmSnowTexDirty = false;
    }
    sbmSnowGL.drawArrays(sbmSnowGL.TRIANGLE_STRIP, 0, 4);
    sbmSnowRAF = requestAnimationFrame(sbmSnowLoop);
  }

  function sbmUpdateSnow(shouldShow) {
    if (!shouldShow) {
      if (sbmSnowRAF) { cancelAnimationFrame(sbmSnowRAF); sbmSnowRAF = null; }
      if (sbmSnowCanvas) { sbmSnowCanvas.remove(); sbmSnowCanvas = null; }
      sbmSnowGL = null;
      sbmSnowUniforms = null;
      sbmSnowTex = null;
      sbmSnowTexCanvas = null;
      sbmSnowTexCtx = null;
      sbmSnowLastPointer = null;
      window.removeEventListener('mousemove', sbmSnowOnMouseMove);
      window.removeEventListener('touchmove', sbmSnowOnTouchMove);
      window.removeEventListener('resize', sbmSnowResize);
      return;
    }
    if (sbmSnowCanvas) return; // 이미 떠 있음
    sbmSnowReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    var canvas = document.createElement('canvas');
    canvas.id = 'sbm-snow-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    var gl = sbmSnowInitGL(canvas);
    if (!gl) { canvas.remove(); return; } // WebGL 미지원 — CSS 단색 배경(--ink)으로 폴백
    sbmSnowCanvas = canvas;
    sbmSnowGL = gl;
    sbmSnowResize();
    sbmSnowRAF = requestAnimationFrame(sbmSnowLoop);

    if (sbmSnowReducedMotion) return; // 발자국 인터랙션(마우스 반응)은 켜지 않는다

    window.addEventListener('mousemove', sbmSnowOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmSnowOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmSnowResize);
  }

  // 트레이딩 터미널 테마 — 배경 레이어에 은은하게(카드 가독성을 해치지 않는
  // 낮은 불투명도) 흐르는 캔들차트를 그린다. 랜덤워크로 가격을 생성하고, 시간이
  // 지나면 오래된 캔들은 왼쪽으로 흘러 사라지고 오른쪽에 새 캔들이 생긴다.
  // 도형만 그리는 저비용 canvas 2D라 프레임 드랍 걱정 없이 계속 켜둘 수 있다.
  var sbmCandleCanvas = null;
  var sbmCandleCtx = null;
  var sbmCandles = null;
  var sbmCandleLastPrice = 100;
  var sbmCandleScrollAccum = 0;
  var sbmCandleRAF = null;
  var sbmCandleLastT = 0;
  var sbmCandleReducedMotion = false;
  var SBM_CANDLE_W = 16; // 캔들 하나 폭(간격 포함, px)
  var SBM_CANDLE_SPEED = 5; // 흐르는 속도(px/초)

  function sbmCandleGen(prevClose) {
    var vol = 2 + Math.random() * 6;
    var open = prevClose;
    var close = open + (Math.random() - 0.5) * vol;
    var high = Math.max(open, close) + Math.random() * vol * 0.5;
    var low = Math.min(open, close) - Math.random() * vol * 0.5;
    return { open: open, close: close, high: high, low: low };
  }

  function sbmCandleSeed() {
    var count = Math.ceil(window.innerWidth / SBM_CANDLE_W) + 2;
    var candles = [];
    var price = sbmCandleLastPrice;
    for (var i = 0; i < count; i++) {
      var c = sbmCandleGen(price);
      candles.push(c);
      price = c.close;
    }
    sbmCandles = candles;
    sbmCandleLastPrice = price;
  }

  function sbmCandleResize() {
    if (!sbmCandleCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sbmCandleCanvas.width = Math.round(window.innerWidth * dpr);
    sbmCandleCanvas.height = Math.round(window.innerHeight * dpr);
    sbmCandleCanvas.style.width = window.innerWidth + 'px';
    sbmCandleCanvas.style.height = window.innerHeight + 'px';
    sbmCandleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmCandleScrollAccum = 0;
    sbmCandleSeed();
    sbmCandleDraw();
  }

  function sbmCandleStep(dt) {
    sbmCandleScrollAccum += SBM_CANDLE_SPEED * dt;
    while (sbmCandleScrollAccum >= SBM_CANDLE_W) {
      sbmCandleScrollAccum -= SBM_CANDLE_W;
      sbmCandles.shift();
      var next = sbmCandleGen(sbmCandleLastPrice);
      sbmCandles.push(next);
      sbmCandleLastPrice = next.close;
    }
  }

  function sbmCandleDraw() {
    if (!sbmCandleCtx || !sbmCandles) return;
    var ctx = sbmCandleCtx;
    var w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    var candles = sbmCandles;
    var min = Infinity, max = -Infinity;
    for (var i = 0; i < candles.length; i++) {
      if (candles[i].low < min) min = candles[i].low;
      if (candles[i].high > max) max = candles[i].high;
    }
    var range = Math.max(1, max - min);
    var padTop = h * 0.18, padBottom = h * 0.12;
    var chartH = h - padTop - padBottom;
    function toY(price) { return padTop + (1 - (price - min) / range) * chartH; }

    ctx.globalAlpha = 0.14; // 카드 가독성을 해치지 않는 은은한 워터마크 느낌
    for (var j = 0; j < candles.length; j++) {
      var c = candles[j];
      var x = w - (candles.length - j) * SBM_CANDLE_W - sbmCandleScrollAccum;
      var up = c.close >= c.open;
      var color = up ? '#1fe08a' : '#ff5d6c';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + SBM_CANDLE_W / 2, toY(c.high));
      ctx.lineTo(x + SBM_CANDLE_W / 2, toY(c.low));
      ctx.stroke();
      var bodyTop = toY(Math.max(c.open, c.close));
      var bodyH = Math.max(1.5, Math.abs(toY(c.open) - toY(c.close)));
      ctx.fillRect(x + 2, bodyTop, SBM_CANDLE_W - 4, bodyH);
    }
    ctx.globalAlpha = 1;
  }

  function sbmCandleLoop(t) {
    if (!sbmCandleCanvas) return;
    var dtMs = sbmCandleLastT ? (t - sbmCandleLastT) : 16.67;
    sbmCandleLastT = t;
    sbmCandleStep(dtMs / 1000);
    sbmCandleDraw();
    sbmCandleRAF = requestAnimationFrame(sbmCandleLoop);
  }

  function sbmUpdateCandleChart(shouldShow) {
    if (!shouldShow) {
      if (sbmCandleRAF) { cancelAnimationFrame(sbmCandleRAF); sbmCandleRAF = null; }
      if (sbmCandleCanvas) { sbmCandleCanvas.remove(); sbmCandleCanvas = null; sbmCandleCtx = null; }
      window.removeEventListener('resize', sbmCandleResize);
      sbmCandles = null;
      sbmCandleLastT = 0;
      sbmCandleScrollAccum = 0;
      return;
    }
    if (sbmCandleCanvas) return; // 이미 떠 있음
    sbmCandleReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmCandleCanvas = document.createElement('canvas');
    sbmCandleCanvas.id = 'sbm-candle-layer';
    sbmCandleCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmCandleCanvas);
    sbmCandleCtx = sbmCandleCanvas.getContext('2d');
    sbmCandleResize(); // 크기 지정 + 캔들 시딩 + 첫 프레임 렌더

    if (sbmCandleReducedMotion) return; // 정적 차트만 보여주고 흐르는 애니메이션은 켜지 않는다

    window.addEventListener('resize', sbmCandleResize);
    sbmCandleLastT = 0;
    sbmCandleRAF = requestAnimationFrame(sbmCandleLoop);
  }

  // 당구대 테마 — 마우스가 큐처럼 공을 밀어내고(반대 방향으로 튕김), 화면
  // 가장자리(레일)에서도 튕기고, 공끼리도 서로 충돌한다. 6개 포켓(모서리 4 +
  // 상하 중앙 2) 중 하나에 들어가면 살짝 줄어들며 사라지고, 테이블이 비면
  // 잠시 후 새 공 세트로 다시 랙(rack)된다.
  var sbmBilliardCanvas = null;
  var sbmBilliardCtx = null;
  var sbmBalls = null;
  var sbmPockets = null;
  var sbmBilliardRAF = null;
  var sbmBilliardLastT = 0;
  var sbmBilliardReducedMotion = false;
  var sbmBilliardMouse = { x: -9999, y: -9999, t: 0, vx: 0, vy: 0 };
  var sbmBilliardRackTimer = 0;
  var SBM_BALL_R = 30; // 기존(15)의 2배
  var SBM_POCKET_R = 57; // 38에서 1.5배
  var SBM_MOUSE_CUE_R = 20;
  var SBM_BALL_COLORS = [
    '#fff7e6', // 큐볼(흰공)
    '#f2c230', '#2f6fe0', '#e0342f', '#7b3fbf',
    '#f07f1a', '#2f9e4f', '#8a2f2f', '#1a1a1a'
  ];

  function sbmBilliardPockets() {
    var w = window.innerWidth, h = window.innerHeight, m = 30; // 포켓이 커진 만큼(1.5배) 화면 밖으로 너무 많이 잘려나가지 않게 여백도 같이 늘림
    return [
      { x: m, y: m }, { x: w / 2, y: m }, { x: w - m, y: m },
      { x: m, y: h - m }, { x: w / 2, y: h - m }, { x: w - m, y: h - m }
    ];
  }

  function sbmBilliardRack() {
    var w = window.innerWidth, h = window.innerHeight;
    var balls = [];
    for (var i = 0; i < SBM_BALL_COLORS.length; i++) {
      var placed = false;
      var x, y, tries = 0;
      while (!placed && tries < 40) {
        tries++;
        x = SBM_BALL_R * 3 + Math.random() * (w - SBM_BALL_R * 6);
        y = SBM_BALL_R * 3 + Math.random() * (h - SBM_BALL_R * 6);
        placed = true;
        for (var j = 0; j < balls.length; j++) {
          var dx = balls[j].x - x, dy = balls[j].y - y;
          if (Math.sqrt(dx * dx + dy * dy) < SBM_BALL_R * 2.4) { placed = false; break; }
        }
      }
      balls.push({
        x: x, y: y, vx: 0, vy: 0, r: SBM_BALL_R,
        color: SBM_BALL_COLORS[i], num: i,
        sinking: false, sinkT: 0
      });
    }
    sbmBalls = balls;
  }

  function sbmBilliardResize() {
    if (!sbmBilliardCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sbmBilliardCanvas.width = Math.round(window.innerWidth * dpr);
    sbmBilliardCanvas.height = Math.round(window.innerHeight * dpr);
    sbmBilliardCanvas.style.width = window.innerWidth + 'px';
    sbmBilliardCanvas.style.height = window.innerHeight + 'px';
    sbmBilliardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmPockets = sbmBilliardPockets();
    if (!sbmBalls) sbmBilliardRack();
    sbmBilliardDraw();
  }

  function sbmBilliardTrackPointer(x, y) {
    var now = performance.now();
    var dt = Math.max(8, now - sbmBilliardMouse.t);
    sbmBilliardMouse.vx = (x - sbmBilliardMouse.x) / dt * 16.67;
    sbmBilliardMouse.vy = (y - sbmBilliardMouse.y) / dt * 16.67;
    sbmBilliardMouse.x = x;
    sbmBilliardMouse.y = y;
    sbmBilliardMouse.t = now;
  }
  function sbmBilliardOnMouseMove(e) { sbmBilliardTrackPointer(e.clientX, e.clientY); }
  function sbmBilliardOnTouchMove(e) {
    if (!e.touches || !e.touches.length) return;
    sbmBilliardTrackPointer(e.touches[0].clientX, e.touches[0].clientY);
  }

  function sbmBilliardStep(dtFactor) {
    var balls = sbmBalls;
    if (!balls) return;
    var w = window.innerWidth, h = window.innerHeight;
    var mx = sbmBilliardMouse.x, my = sbmBilliardMouse.y;
    var mouseSpeed = Math.sqrt(sbmBilliardMouse.vx * sbmBilliardMouse.vx + sbmBilliardMouse.vy * sbmBilliardMouse.vy);
    var i, ball;

    for (i = 0; i < balls.length; i++) {
      ball = balls[i];
      if (ball.sinking) { ball.sinkT += dtFactor; continue; }

      // 마우스(큐) 충돌 — 닿는 순간 반대 방향으로 튕겨나간다
      var dx = ball.x - mx, dy = ball.y - my;
      var dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
      var minDist = ball.r + SBM_MOUSE_CUE_R;
      if (dist < minDist) {
        var nx = dx / dist, ny = dy / dist;
        ball.x += nx * (minDist - dist);
        ball.y += ny * (minDist - dist);
        var impulse = Math.max(mouseSpeed * 0.8, 6);
        ball.vx += nx * impulse;
        ball.vy += ny * impulse;
      }
    }

    // 공-공 충돌(단순 탄성 충돌) — 개수가 적어 전수비교(O(n^2))로도 가볍다
    for (i = 0; i < balls.length; i++) {
      if (balls[i].sinking) continue;
      for (var k = i + 1; k < balls.length; k++) {
        if (balls[k].sinking) continue;
        var a = balls[i], b = balls[k];
        var ddx = b.x - a.x, ddy = b.y - a.y;
        var d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.0001;
        var minD = a.r + b.r;
        if (d < minD) {
          var ux = ddx / d, uy = ddy / d;
          var overlap = (minD - d) / 2;
          a.x -= ux * overlap; a.y -= uy * overlap;
          b.x += ux * overlap; b.y += uy * overlap;
          var relVx = b.vx - a.vx, relVy = b.vy - a.vy;
          var rel = relVx * ux + relVy * uy;
          if (rel < 0) {
            a.vx += ux * rel; a.vy += uy * rel;
            b.vx -= ux * rel; b.vy -= uy * rel;
          }
        }
      }
    }

    for (i = 0; i < balls.length; i++) {
      ball = balls[i];
      if (ball.sinking) continue;

      ball.vx *= 0.988; // 테이블 마찰 — 시간이 지나면 서서히 멈춘다
      ball.vy *= 0.988;
      ball.x += ball.vx * dtFactor;
      ball.y += ball.vy * dtFactor;

      // 레일(화면 가장자리) 반사
      if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx) * 0.82; }
      else if (ball.x > w - ball.r) { ball.x = w - ball.r; ball.vx = -Math.abs(ball.vx) * 0.82; }
      if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy) * 0.82; }
      else if (ball.y > h - ball.r) { ball.y = h - ball.r; ball.vy = -Math.abs(ball.vy) * 0.82; }

      // 포켓 판정 — 중심이 포켓 반경 안에 들어오면 가라앉기 시작
      for (var p = 0; p < sbmPockets.length; p++) {
        var pdx = ball.x - sbmPockets[p].x, pdy = ball.y - sbmPockets[p].y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) < SBM_POCKET_R * 0.55) {
          ball.sinking = true;
          ball.sinkX = sbmPockets[p].x;
          ball.sinkY = sbmPockets[p].y;
          break;
        }
      }
    }

    // 다 가라앉은 공은 배열에서 제거하고, 테이블이 비면 잠시 후 다시 랙
    sbmBalls = balls.filter(function (bl) { return !(bl.sinking && bl.sinkT > 0.35); });
    if (sbmBalls.length === 0) {
      sbmBilliardRackTimer += dtFactor / 60;
      if (sbmBilliardRackTimer > 2.2) {
        sbmBilliardRackTimer = 0;
        sbmBilliardRack();
      }
    }

    sbmBilliardMouse.vx *= 0.85;
    sbmBilliardMouse.vy *= 0.85;
  }

  function sbmBilliardDraw() {
    if (!sbmBilliardCtx || !sbmBalls || !sbmPockets) return;
    var ctx = sbmBilliardCtx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // 포켓
    for (var p = 0; p < sbmPockets.length; p++) {
      ctx.beginPath();
      ctx.arc(sbmPockets[p].x, sbmPockets[p].y, SBM_POCKET_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
    }

    ctx.font = '18px sans-serif'; // 공이 커진 만큼 번호 폰트도 키움 — 개수가 적어 고정해도 저렴하다
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (var i = 0; i < sbmBalls.length; i++) {
      var ball = sbmBalls[i];
      var t = ball.sinking ? Math.max(0, 1 - ball.sinkT / 0.35) : 1;
      var x = ball.sinking ? ball.sinkX + (ball.x - ball.sinkX) * t : ball.x;
      var y = ball.sinking ? ball.sinkY + (ball.y - ball.sinkY) * t : ball.y;
      var r = ball.r * t;
      if (r <= 0.5) continue;

      ctx.save();
      ctx.globalAlpha = t;
      // 그림자
      ctx.beginPath();
      ctx.ellipse(x + 3, y + 4, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fill();
      // 몸통
      var grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.15, ball.color);
      grad.addColorStop(1, ball.color);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      // 번호 서클(큐볼 제외)
      if (ball.num > 0) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = '#f4f0e6';
        ctx.fill();
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(String(ball.num), x, y + 0.5);
      }
      ctx.restore();
    }
  }

  function sbmBilliardLoop(t) {
    if (!sbmBilliardCanvas) return;
    var dtMs = sbmBilliardLastT ? (t - sbmBilliardLastT) : 16.67;
    sbmBilliardLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67);
    sbmBilliardStep(dtFactor);
    sbmBilliardDraw();
    sbmBilliardRAF = requestAnimationFrame(sbmBilliardLoop);
  }

  function sbmUpdateBilliards(shouldShow) {
    if (!shouldShow) {
      if (sbmBilliardRAF) { cancelAnimationFrame(sbmBilliardRAF); sbmBilliardRAF = null; }
      if (sbmBilliardCanvas) { sbmBilliardCanvas.remove(); sbmBilliardCanvas = null; sbmBilliardCtx = null; }
      window.removeEventListener('mousemove', sbmBilliardOnMouseMove);
      window.removeEventListener('touchmove', sbmBilliardOnTouchMove);
      window.removeEventListener('resize', sbmBilliardResize);
      sbmBalls = null;
      sbmPockets = null;
      sbmBilliardLastT = 0;
      sbmBilliardRackTimer = 0;
      return;
    }
    if (sbmBilliardCanvas) return; // 이미 떠 있음
    sbmBilliardReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmBilliardCanvas = document.createElement('canvas');
    sbmBilliardCanvas.id = 'sbm-billiard-layer';
    sbmBilliardCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmBilliardCanvas);
    sbmBilliardCtx = sbmBilliardCanvas.getContext('2d');
    sbmBilliardResize(); // 크기 지정 + 랙 + 첫 프레임 렌더

    if (sbmBilliardReducedMotion) return; // 정적 배치만 보여주고 마우스 반응·애니메이션은 켜지 않는다

    window.addEventListener('mousemove', sbmBilliardOnMouseMove, { passive: true });
    window.addEventListener('touchmove', sbmBilliardOnTouchMove, { passive: true });
    window.addEventListener('resize', sbmBilliardResize);
    sbmBilliardLastT = 0;
    sbmBilliardRAF = requestAnimationFrame(sbmBilliardLoop);
  }

  // 불꽃놀이 야시장 테마 — 배경에서 로켓이 솟아올랐다가 정점에서 터지는 불꽃놀이가
  // 계속 반복된다. 매 프레임 화면을 완전히 지우는 대신 아주 낮은 불투명도의 짙은
  // 남색을 겹쳐 칠해서(clearRect 대신 fillRect) 로켓·불티가 자연스럽게 잔상(꼬리)을
  // 남기게 하고, 이 오버레이 자체가 밤하늘 배경 역할도 겸한다(별도 배경 이미지 불필요).
  // 파티클은 ctx.globalCompositeOperation='lighter'(가산 블렌딩)로 겹칠수록 밝아지게
  // 그려 실제 불꽃놀이의 발광 느낌을 낸다. 폭죽마다 모란형(고르게 퍼짐)·버드나무형
  // (길게 늘어지며 낙하)·크래클형(중간에 잘게 한 번 더 터짐) 중 하나를 무작위로 쓴다.
  var sbmFwCanvas = null;
  var sbmFwCtx = null;
  var sbmFwRockets = null;
  var sbmFwParticles = null;
  var sbmFwFlashes = null; // 폭발 순간 밤하늘이 잠깐 밝아지는 효과
  var sbmFwRAF = null;
  var sbmFwLastT = 0;
  var sbmFwNextLaunchIn = 0.6;
  var sbmFwReducedMotion = false;
  var SBM_FW_MAX_PARTICLES = 1400; // 파티클 양이 2배가 된 만큼 상한도 같이 올림
  var SBM_FW_PALETTES = [
    ['#ff5e5e', '#ff9d5e', '#ffd35e'],
    ['#5ecbff', '#5e8bff', '#c15eff'],
    ['#ff5ecb', '#ff5e8b', '#ffe15e'],
    ['#5effa0', '#5eff5e', '#c8ff5e'],
    ['#ffffff', '#ffe9b3', '#ffd35e']
  ];
  var SBM_FW_TYPES = ['peony', 'willow', 'crackle'];

  function sbmFwPickPalette() { return SBM_FW_PALETTES[(Math.random() * SBM_FW_PALETTES.length) | 0]; }
  function sbmFwPickColor(palette) { return palette[(Math.random() * palette.length) | 0]; }

  function sbmFwSpawnBurst(x, y, palette, type) {
    var count = (type === 'peony' ? 90 : type === 'willow' ? 70 : 80) * 2; // 파티클 양 2배
    var speedBase = (type === 'willow' ? 2.1 : 3.3) * 2; // 폭발 범위 2배
    var gravity = type === 'willow' ? 0.055 : 0.035;
    var baseSize = type === 'willow' ? 1.6 : 2;
    sbmFwFlashes.push({ x: x, y: y, color: sbmFwPickColor(palette), life: 0, maxLife: 0.25 }); // 줄어드는 속도 2배(수명 절반)
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = speedBase * (0.55 + Math.random() * 0.65);
      var maxLife = type === 'willow' ? (2.4 + Math.random() * 0.6) : (1.5 + Math.random() * 0.5);
      sbmFwParticles.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0, maxLife: maxLife, gravity: gravity, drag: 0.985,
        color: sbmFwPickColor(palette), size: baseSize * (0.5 + Math.random() * 1.5), // 크기도 다양하게
        crackleAt: type === 'crackle' ? maxLife * (0.4 + Math.random() * 0.3) : -1,
        crackled: false
      });
    }
  }

  function sbmFwSpawnRocket() {
    var w = window.innerWidth, h = window.innerHeight;
    var palette = sbmFwPickPalette();
    sbmFwRockets.push({
      x: w * (0.12 + Math.random() * 0.76), y: h,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -(7.5 + Math.random() * 2.8),
      gravity: 0.1,
      color: sbmFwPickColor(palette),
      palette: palette,
      type: SBM_FW_TYPES[(Math.random() * SBM_FW_TYPES.length) | 0]
    });
  }

  function sbmFwSeed() {
    sbmFwRockets = [];
    sbmFwParticles = [];
    sbmFwFlashes = [];
    sbmFwNextLaunchIn = 0.4;
  }

  function sbmFwResize() {
    if (!sbmFwCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    sbmFwCanvas.width = Math.round(window.innerWidth * dpr);
    sbmFwCanvas.height = Math.round(window.innerHeight * dpr);
    sbmFwCanvas.style.width = window.innerWidth + 'px';
    sbmFwCanvas.style.height = window.innerHeight + 'px';
    sbmFwCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sbmFwCtx.fillStyle = '#08051a';
    sbmFwCtx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }

  function sbmFwStep(dtFactor) {
    var w = window.innerWidth, h = window.innerHeight;
    var dtSec = dtFactor / 60;

    sbmFwNextLaunchIn -= dtSec;
    if (sbmFwNextLaunchIn <= 0 && sbmFwParticles.length < SBM_FW_MAX_PARTICLES * 0.8) {
      sbmFwSpawnRocket();
      sbmFwNextLaunchIn = 1.1 + Math.random() * 1.8;
    }

    var nextRockets = [];
    for (var i = 0; i < sbmFwRockets.length; i++) {
      var r = sbmFwRockets[i];
      r.vy += r.gravity * dtFactor;
      r.x += r.vx * dtFactor;
      r.y += r.vy * dtFactor;
      if (r.vy >= 0 || r.y < h * 0.1) {
        sbmFwSpawnBurst(r.x, r.y, r.palette, r.type);
        continue; // 터졌으니 로켓 배열에서 제외
      }
      nextRockets.push(r);
    }
    sbmFwRockets = nextRockets;

    var nextParticles = [];
    for (var j = 0; j < sbmFwParticles.length; j++) {
      var p = sbmFwParticles[j];
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.gravity * dtFactor;
      p.x += p.vx * dtFactor;
      p.y += p.vy * dtFactor;
      p.life += dtSec;

      if (p.crackleAt >= 0 && !p.crackled && p.life >= p.crackleAt) {
        p.crackled = true;
        for (var k = 0; k < 4; k++) {
          var a2 = Math.random() * Math.PI * 2;
          var s2 = 1 + Math.random() * 1.6;
          sbmFwParticles.push({
            x: p.x, y: p.y, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2,
            life: 0, maxLife: 0.35 + Math.random() * 0.25, gravity: 0.02, drag: 0.97,
            color: p.color, size: 1.4 * (0.5 + Math.random() * 1.5), crackleAt: -1, crackled: true
          });
        }
      }

      if (p.life < p.maxLife && p.x > -50 && p.x < w + 50 && p.y < h + 50) {
        nextParticles.push(p);
      }
    }
    sbmFwParticles = nextParticles;

    var nextFlashes = [];
    for (var m = 0; m < sbmFwFlashes.length; m++) {
      var fl = sbmFwFlashes[m];
      fl.life += dtSec;
      if (fl.life < fl.maxLife) nextFlashes.push(fl);
    }
    sbmFwFlashes = nextFlashes;
  }

  function sbmFwDraw() {
    if (!sbmFwCtx) return;
    var ctx = sbmFwCtx;
    var w = window.innerWidth, h = window.innerHeight;

    // 완전히 지우는 대신 옅은 밤하늘색을 겹쳐 칠해 잔상(꼬리)이 남게 한다
    ctx.fillStyle = 'rgba(8,5,24,0.22)';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 폭발 순간 그 자리를 중심으로 밤하늘이 잠깐 밝아지는 플래시 — 배경이 너무
    // 단조롭지 않게, 터질 때마다 색이 살짝 번지는 느낌을 준다
    var flashRadius = Math.max(w, h) * 0.55;
    for (var f = 0; f < sbmFwFlashes.length; f++) {
      var fl = sbmFwFlashes[f];
      var flashAlpha = (1 - fl.life / fl.maxLife) * 0.175; // 최대 밝기 절반
      var grad = ctx.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, flashRadius);
      grad.addColorStop(0, sbmFwRgba(fl.color, flashAlpha));
      grad.addColorStop(1, sbmFwRgba(fl.color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }

    for (var i = 0; i < sbmFwRockets.length; i++) {
      var r = sbmFwRockets[i];
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = r.color;
      ctx.fill();
    }

    for (var j = 0; j < sbmFwParticles.length; j++) {
      var p = sbmFwParticles[j];
      var alpha = Math.max(0, 1 - p.life / p.maxLife);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = sbmFwRgba(p.color, alpha);
      ctx.fill();
    }

    ctx.restore();
  }

  function sbmFwRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
  }

  function sbmFwDrawStatic() {
    if (!sbmFwCtx) return;
    var ctx = sbmFwCtx, w = window.innerWidth, h = window.innerHeight;
    ctx.fillStyle = '#08051a';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var palette = sbmFwPickPalette();
    var cx = w / 2, cy = h * 0.32;
    for (var i = 0; i < 60; i++) {
      var angle = (Math.PI * 2 * i) / 60;
      var dist = 60 + Math.random() * 40;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 2, 0, Math.PI * 2);
      ctx.fillStyle = sbmFwRgba(sbmFwPickColor(palette), 0.85);
      ctx.fill();
    }
    ctx.restore();
  }

  function sbmFwLoop(t) {
    if (!sbmFwCanvas) return;
    var dtMs = sbmFwLastT ? (t - sbmFwLastT) : 16.67;
    sbmFwLastT = t;
    var dtFactor = Math.min(3, dtMs / 16.67);
    sbmFwStep(dtFactor);
    sbmFwDraw();
    sbmFwRAF = requestAnimationFrame(sbmFwLoop);
  }

  function sbmUpdateFireworks(shouldShow) {
    if (!shouldShow) {
      if (sbmFwRAF) { cancelAnimationFrame(sbmFwRAF); sbmFwRAF = null; }
      if (sbmFwCanvas) { sbmFwCanvas.remove(); sbmFwCanvas = null; sbmFwCtx = null; }
      window.removeEventListener('resize', sbmFwResize);
      sbmFwRockets = null;
      sbmFwParticles = null;
      sbmFwFlashes = null;
      sbmFwLastT = 0;
      return;
    }
    if (sbmFwCanvas) return; // 이미 떠 있음
    sbmFwReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    sbmFwCanvas = document.createElement('canvas');
    sbmFwCanvas.id = 'sbm-firework-layer';
    sbmFwCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sbmFwCanvas);
    sbmFwCtx = sbmFwCanvas.getContext('2d');
    sbmFwSeed();
    sbmFwResize();

    if (sbmFwReducedMotion) { sbmFwDrawStatic(); return; } // 정적 폭죽 한 번만 보여주고 애니메이션은 켜지 않는다

    window.addEventListener('resize', sbmFwResize);
    sbmFwLastT = 0;
    sbmFwRAF = requestAnimationFrame(sbmFwLoop);
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

  // 관리자는 구매 없이도 모든 스킨을 즉시 장착할 수 있게, "보유 여부"를 관리자에겐
  // 항상 true로 취급한다(실제 구매 내역과는 무관 — 서버 equipSkin도 관리자는
  // 보유 체크를 건너뛰도록 맞춰뒀다).
  function sbmOwnsSkin(skinId) {
    return !!ownedSkins[skinId] || !!window.sbmIsAdmin;
  }

  function renderSkinCards() {
    cards.forEach(function (card) {
      var skinId = card.getAttribute('data-skin-id');
      var owned = sbmOwnsSkin(skinId);
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
        var owned = sbmOwnsSkin(skinId);
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
