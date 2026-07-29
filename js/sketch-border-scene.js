// 16번 — 손그림 스케치 테마. CodePen "boiling effect w/ rough.js"(vii120,
// https://codepen.io/vii120/pen/LExZavZ)가 쓰는 방식 그대로 — rough.js로 도형을
// 그리고 일정 주기로 다시 그리면, roughness가 매번 새로 랜덤 샘플링되면서 손그림
// 선이 살짝씩 들끓는(boiling) 느낌을 준다. 원본이 아이콘마다 색연필처럼 다른 색을
// 쓰는 것처럼, 여기서도 카드·모달마다 팔레트에서 고른 색을 고정으로 부여한다.
import rough from 'https://esm.sh/roughjs@4.6.6';

// 다른 테마들이 카드·모달 배지를 붙일 때 쓰던 셀렉터 목록과 동일 —
// 이 앱의 "모든 카드/모달" 전체 집합이다.
var TARGET_SELECTOR = '.ticket:not(.hero-ticket), .verify-modal, .propose-modal, ' +
  '.exchange-modal, .bet-modal, .review-modal, .manage-modal, .profile-modal, ' +
  '.report-modal, .boot-card';
var OVERLAY_CLASS = 'sbm-sketch-border-svg';
var REDRAW_INTERVAL_MS = 260;
var CORNER_RADIUS = 14;
// 색연필 팔레트 — 카드마다 이 중 하나를 고정으로 배정한다(매번 랜덤이면 다시
// 그릴 때마다 색까지 바뀌어 산만해지므로, 흔들리는 건 선의 모양뿐이다).
var PALETTE = ['#c1503f', '#3b6ea5', '#3a8f5b', '#c98a2c', '#8a5fb0', '#2f8f96'];

var active = false;
var rafId = null;
var lastDrawTime = 0;
var paletteCounter = 0;

function isReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function ensureOverlay(el) {
  var svg = el.querySelector(':scope > svg.' + OVERLAY_CLASS);
  if (svg) return svg;
  svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', OVERLAY_CLASS);
  svg.setAttribute('aria-hidden', 'true');
  el.insertBefore(svg, el.firstChild);
  return svg;
}

function colorFor(el) {
  if (!el.dataset.sbmSketchColor) {
    el.dataset.sbmSketchColor = PALETTE[paletteCounter % PALETTE.length];
    paletteCounter++;
  }
  return el.dataset.sbmSketchColor;
}

// 모서리가 둥근 사각형 경로 — rough.js는 rectangle()에 라운딩 옵션이 없어서,
// 둥근 모서리가 필요하면 path()에 직접 그린 SVG path(호 4개 포함)를 넘겨야 한다.
function roundedRectPath(x, y, w, h, r) {
  var rr = Math.min(r, w / 2, h / 2);
  return 'M ' + (x + rr) + ' ' + y +
    ' H ' + (x + w - rr) +
    ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (x + w) + ' ' + (y + rr) +
    ' V ' + (y + h - rr) +
    ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (x + w - rr) + ' ' + (y + h) +
    ' H ' + (x + rr) +
    ' A ' + rr + ' ' + rr + ' 0 0 1 ' + x + ' ' + (y + h - rr) +
    ' V ' + (y + rr) +
    ' A ' + rr + ' ' + rr + ' 0 0 1 ' + (x + rr) + ' ' + y +
    ' Z';
}

function drawBorder(el, svg) {
  var w = el.offsetWidth, h = el.offsetHeight;
  if (w < 4 || h < 4) return;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  var rc = rough.svg(svg);
  var m = 2;
  var d = roundedRectPath(m, m, Math.max(1, w - m * 2), Math.max(1, h - m * 2), CORNER_RADIUS);
  var node = rc.path(d, {
    stroke: colorFor(el),
    strokeWidth: 2.2,
    roughness: 2.2,
    bowing: 1.5,
    fill: 'none',
  });
  svg.appendChild(node);
}

function drawAll() {
  var els = document.querySelectorAll(TARGET_SELECTOR);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.getClientRects().length === 0) continue; // display:none 등 렌더링 안 되는 요소는 건너뜀
    drawBorder(el, ensureOverlay(el));
  }
}

function tick(t) {
  rafId = requestAnimationFrame(tick);
  if (t - lastDrawTime < REDRAW_INTERVAL_MS) return;
  lastDrawTime = t;
  drawAll();
}

function show() {
  if (active) return;
  active = true;
  lastDrawTime = 0;
  if (isReducedMotion()) { drawAll(); return; } // 정적 프레임 한 번만 — 계속 들끓지 않게
  rafId = requestAnimationFrame(tick);
}

function hide() {
  if (!active) return;
  active = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  var svgs = document.querySelectorAll('.' + OVERLAY_CLASS);
  for (var i = 0; i < svgs.length; i++) svgs[i].remove();
}

function syncFromHtmlClass() {
  var isOn = document.documentElement.classList.contains('theme-sketch-border');
  if (isOn) show(); else hide();
}

// js/skins.js가 html에 theme-* 클래스를 갈아끼우는 방식이라, class 변화를 직접
// 관찰한다(js/winter-scene.js·js/firework-scene.js와 동일한 패턴).
new MutationObserver(syncFromHtmlClass).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['class'],
});
syncFromHtmlClass();
