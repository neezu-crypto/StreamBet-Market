// 16번 — 손그림 스케치 테마. CodePen "boiling effect w/ rough.js"(vii120,
// https://codepen.io/vii120/pen/LExZavZ)가 쓰는 방식 그대로 — rough.js로 도형을
// 그리고 일정 주기로 다시 그리면, roughness가 매번 새로 랜덤 샘플링되면서 손그림
// 선이 살짝씩 들끓는(boiling) 느낌을 준다. 원본은 아이콘에 적용했지만, 여기선
// 모든 카드·모달의 테두리(perimeter rectangle)에 그대로 적용한다.
import rough from 'https://esm.sh/roughjs@4.6.6';

// 다른 테마들이 카드·모달 배지를 붙일 때 쓰던 셀렉터 목록과 동일 —
// 이 앱의 "모든 카드/모달" 전체 집합이다.
var TARGET_SELECTOR = '.ticket:not(.hero-ticket), .verify-modal, .propose-modal, ' +
  '.exchange-modal, .bet-modal, .review-modal, .manage-modal, .profile-modal, ' +
  '.report-modal, .boot-card';
var OVERLAY_CLASS = 'sbm-sketch-border-svg';
var REDRAW_INTERVAL_MS = 260;

var active = false;
var rafId = null;
var lastDrawTime = 0;

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

function drawBorder(el, svg, ink) {
  var w = el.offsetWidth, h = el.offsetHeight;
  if (w < 4 || h < 4) return;
  svg.setAttribute('width', w);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  var rc = rough.svg(svg);
  var m = 2;
  var node = rc.rectangle(m, m, Math.max(1, w - m * 2), Math.max(1, h - m * 2), {
    stroke: ink,
    strokeWidth: 2.2,
    roughness: 2.2,
    bowing: 1.5,
    fill: 'none',
  });
  svg.appendChild(node);
}

function drawAll() {
  var ink = getComputedStyle(document.documentElement).getPropertyValue('--sketch-ink').trim() || '#33302a';
  var els = document.querySelectorAll(TARGET_SELECTOR);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (el.getClientRects().length === 0) continue; // display:none 등 렌더링 안 되는 요소는 건너뜀
    drawBorder(el, ensureOverlay(el), ink);
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
