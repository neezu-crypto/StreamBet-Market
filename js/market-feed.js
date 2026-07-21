// 실데이터 기반 마켓 피드 렌더링 — /bettingMarket/markets 실시간 리스너로 카드를 그린다.
var sbmMarketsCache = {};
window.sbmMarketsCache = sbmMarketsCache;

// 검색 필터에서 스트리머 이름으로도 찾을 수 있게 stocks의 id → 닉네임을 한 번 받아둔다.
var sbmStockNames = {};
if (window.sbmFirebase && window.sbmDb) {
  var sbmFbInit = window.sbmFirebase;
  sbmFbInit.get(sbmFbInit.ref(window.sbmDb, 'stocks')).then(function (snap) {
    var val = snap.val() || {};
    Object.keys(val).forEach(function (id) { sbmStockNames[id] = val[id].name; });
  });
}

function sbmComputeOdds(market) {
  var rake = market.rakeRate != null ? market.rakeRate : 0.05;
  var total = market.totalPool || 0;
  var distributable = total * (1 - rake);
  var odds = {};
  Object.keys(market.outcomes || {}).forEach(function (id) {
    var pool = market.outcomes[id].pool || 0;
    odds[id] = pool > 0 ? distributable / pool : 0;
  });
  return odds;
}
window.sbmComputeOdds = sbmComputeOdds;

function sbmFmtNum(n) { return Math.round(n || 0).toLocaleString('ko-KR'); }
function sbmTypeLabel(type) { return type === '1v1' ? '1vs1' : type === 'group' ? '단체전' : '개인전'; }
function sbmTimeLeft(ms) {
  if (ms <= 0) return '마감';
  var mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + '분';
  var hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '시간 ' + (mins % 60) + '분';
  return Math.floor(hours / 24) + '일 ' + (hours % 24) + '시간';
}

function sbmOutcomeArray(market) {
  return Object.keys(market.outcomes || {}).map(function (id) {
    return Object.assign({ id: id }, market.outcomes[id]);
  });
}

function sbmCardStubActions(marketId, title) {
  return '<div class="stub-foot-actions">' +
    '<button class="btn-report js-open-report" data-market-id="' + marketId + '" data-title="' + title + '" type="button">신고</button>' +
    '<button class="btn-bet ghost js-open-bet" data-market-id="' + marketId + '">배팅하기</button>' +
    '</div>';
}

function sbmRenderOpenCard(marketId, market, isHero) {
  var outcomes = sbmOutcomeArray(market);
  var odds = sbmComputeOdds(market);
  var total = market.totalPool || 0;
  var isMulti = outcomes.length > 2;
  // 06번 — 배팅 마감과 이벤트 마감은 별개 시점. 배팅은 마감됐어도 이벤트가 아직 진행중이면
  // "진행중인 마켓"으로 계속 보여준다(배팅 버튼만 뺀다).
  var bettingClosed = market.status === 'closed';
  var closesIn = (market.timing.bettingClosesAt || 0) - Date.now();
  var isUrgent = !bettingClosed && closesIn > 0 && closesIn <= 10 * 60 * 1000;

  var oddsHtml;
  if (isMulti) {
    oddsHtml = '<div class="multi-outcomes">' + outcomes.map(function (o) {
      var pct = total > 0 ? Math.round(((o.pool || 0) / total) * 100) : 0;
      return '<div class="outcome-row"><span class="name">' + o.label + '</span><div class="bar"><i style="width:' + pct + '%"></i></div><span class="odd num">' + (odds[o.id] ? odds[o.id].toFixed(1) : '-') + 'x</span></div>';
    }).join('') + '</div>';
  } else {
    oddsHtml = '<div class="pool-bar"><i style="width:' + (total > 0 ? Math.round(((outcomes[0].pool || 0) / total) * 100) : 0) + '%"></i></div>' +
      '<div class="odds-row">' + outcomes.map(function (o, i) {
        var pct = total > 0 ? Math.round(((o.pool || 0) / total) * 100) : 0;
        return '<div class="odds-cell ' + (i === 0 ? 'side-yes' : 'side-no') + '"><div class="label">' + o.label + ' · ' + pct + '%</div><div class="value num">' + (odds[o.id] ? odds[o.id].toFixed(1) : '-') + 'x</div></div>';
      }).join('') + '</div>';
  }

  var badges = (bettingClosed
    ? '<span class="badge badge-pending">배팅 마감</span>'
    : '<span class="badge ' + (isUrgent ? 'badge-live' : 'badge-open') + '">' + (isUrgent ? '마감임박' : '진행중') + '</span>') +
    '<span class="badge badge-type">' + sbmTypeLabel(market.type) + '</span>' +
    (market.category === 'userProposed' ? '<span class="badge badge-type">유저 제안</span>' : '');

  var meta = bettingClosed
    ? '<span>이벤트 종료까지 ' + sbmTimeLeft((market.timing.eventEndsAt || 0) - Date.now()) + '</span><span class="sep">·</span><span>총 풀 <span class="num">' + sbmFmtNum(total) + '</span>원</span>'
    : '<span>마감까지 ' + sbmTimeLeft(closesIn) + '</span><span class="sep">·</span><span>총 풀 <span class="num">' + sbmFmtNum(total) + '</span>원</span>';

  var participants = bettingClosed ? '배팅 마감 · 이벤트 진행중 · 카드 클릭 시 관리(관리자 · 인증 스트리머)' : '카드 클릭 시 관리(관리자 · 인증 스트리머)';
  var actions = bettingClosed
    ? '<div class="stub-foot-actions"><button class="btn-report js-open-report" data-market-id="' + marketId + '" data-title="' + market.title + '" type="button">신고</button></div>'
    : sbmCardStubActions(marketId, market.title);

  return '<article class="ticket js-manage-market" data-market-id="' + marketId + '" role="button" tabindex="0">' +
    '<div class="ticket-main"><div class="badges">' + badges + '</div>' +
    '<h2 class="ticket-title">' + market.title + '</h2>' +
    '<div class="ticket-meta">' + meta + '</div></div>' +
    '<div class="ticket-stub">' + oddsHtml +
    '<div class="stub-foot"><span class="participants">' + participants + '</span>' +
    actions + '</div></div></article>';
}

function sbmRenderPendingCard(marketId, market) {
  var likeCount = (market.validation && market.validation.likeCount) || 0;
  var pct = Math.min(100, Math.round((likeCount / 20) * 100));
  return '<article class="ticket js-open-review" data-market-id="' + marketId + '" role="button" tabindex="0" style="cursor:pointer;">' +
    '<div class="ticket-main"><div class="badges"><span class="badge badge-pending">검증중</span>' +
    '<span class="badge badge-type">' + sbmTypeLabel(market.type) + '</span></div>' +
    '<h2 class="ticket-title">' + market.title + '</h2>' +
    '<div class="verify-progress"><span>좋아요 ' + likeCount + ' / 20</span><div class="track"><i style="width:' + pct + '%"></i></div></div></div>' +
    '<div class="ticket-stub"><div class="stub-foot" style="margin-top:0;"><span class="participants">배팅 오픈 대기 · 카드 클릭 시 검수(관리자 · 인증 스트리머)</span>' +
    '<div class="stub-foot-actions">' +
    '<button class="btn-report js-open-report" data-market-id="' + marketId + '" data-title="' + market.title + '" type="button">신고</button>' +
    '<button class="btn-bet ghost js-like-market" data-market-id="' + marketId + '">좋아요</button>' +
    '</div></div></div></article>';
}

// 배팅 마감 시각이 지나 closeBettingScheduled가 자동으로 마감시켰지만 아직 판정 전인 마켓.
// 이걸 안 보여주면 판정 나기 전까지 메인 화면에서 마켓이 통째로 사라져 보인다.
function sbmRenderClosedPendingCard(marketId, market) {
  var total = market.totalPool || 0;
  return '<article class="ticket js-manage-market" data-market-id="' + marketId + '" role="button" tabindex="0">' +
    '<div class="ticket-main"><div class="badges">' +
    '<span class="badge badge-pending">정산 대기중</span>' +
    '<span class="badge badge-type">' + sbmTypeLabel(market.type) + '</span></div>' +
    '<h2 class="ticket-title">' + market.title + '</h2>' +
    '<div class="ticket-meta"><span>이벤트 종료 · 총 풀 <span class="num">' + sbmFmtNum(total) + '</span>원</span></div></div>' +
    '<div class="ticket-stub"><div class="stub-foot" style="margin-top:0;">' +
    '<span class="participants">판정 대기 중 · 카드 클릭 시 판정(관리자 · 인증 스트리머)</span>' +
    '<div class="stub-foot-actions">' +
    '<button class="btn-report js-open-report" data-market-id="' + marketId + '" data-title="' + market.title + '" type="button">신고</button>' +
    '</div></div></div></article>';
}

function sbmRenderClosedCard(marketId, market, batch) {
  var isVoid = market.status === 'void';
  var settledAt = market.settlement ? market.settlement.settledAt : (market.adminAction ? market.adminAction.at : Date.now());
  var dateStr = new Date(settledAt).toLocaleDateString('ko-KR');
  var resultLabel, resultSmall, payout;
  if (isVoid) {
    resultLabel = '무효 처리';
    resultSmall = (market.adminAction && market.adminAction.reason) || '전액 환불';
    payout = '1.0x<small>원금 반환</small>';
  } else if (market.settlement) {
    var winOutcome = (market.outcomes || {})[market.settlement.winningOutcomeId] || {};
    resultLabel = (winOutcome.label || '') + ' 적중';
    resultSmall = '확정 배당 지급';
    payout = market.settlement.payoutMultiplier.toFixed(2) + 'x<small>확정 배당</small>';
  } else {
    resultLabel = '처리중';
    resultSmall = '';
    payout = '-';
  }
  return '<article class="ticket settled">' +
    '<div class="ticket-main"><div class="badges">' +
    '<span class="badge badge-settled">정산 완료' + (isVoid ? ' · 무효' : '') + '</span>' +
    '<span class="badge badge-type">' + sbmTypeLabel(market.type) + '</span></div>' +
    '<h2 class="ticket-title">' + market.title + '</h2>' +
    '<div class="ticket-meta"><span>' + dateStr + ' 정산 완료</span></div></div>' +
    '<div class="ticket-stub"><div class="result-row">' +
    '<div class="result-outcome ' + (isVoid ? 'void' : 'win') + '">' + resultLabel + '<small>' + resultSmall + '</small></div>' +
    '<div class="result-payout">' + payout + '</div></div></div></article>';
}

function sbmRenderAdminLists() {
  var pendingList = document.getElementById('admin-pending-list');
  var openList = document.getElementById('admin-open-list');
  if (!pendingList || !openList) return;
  var pending = [], open = [];
  Object.keys(sbmMarketsCache).forEach(function (id) {
    var m = sbmMarketsCache[id];
    if (m.status === 'pendingValidation') pending.push([id, m]);
    else if (m.status === 'open' || m.status === 'closed') open.push([id, m]);
  });
  pendingList.innerHTML = pending.length ? pending.map(function (e) {
    return '<button class="admin-item-btn js-admin-goto-review" data-market-id="' + e[0] + '" type="button">' +
      '<span>' + e[1].title + '</span><span class="admin-item-sub">검수하기</span></button>';
  }).join('') : '<div class="admin-item-sub">검수 대기중인 제안이 없습니다.</div>';
  openList.innerHTML = open.length ? open.map(function (e) {
    return '<button class="admin-item-btn js-admin-goto-manage" data-market-id="' + e[0] + '" type="button">' +
      '<span>' + e[1].title + '</span><span class="admin-item-sub">관리하기</span></button>';
  }).join('') : '<div class="admin-item-sub">관리할 마켓이 없습니다.</div>';

  pendingList.querySelectorAll('.js-admin-goto-review').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = document.querySelector('.js-open-review[data-market-id="' + btn.getAttribute('data-market-id') + '"]');
      if (card) card.click();
    });
  });
  openList.querySelectorAll('.js-admin-goto-manage').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var card = document.querySelector('.js-manage-market[data-market-id="' + btn.getAttribute('data-market-id') + '"]');
      if (card) card.click();
    });
  });
}

var sbmFeedFilter = { search: '', type: 'all', sort: 'closing' };

function sbmMatchesFilter(m) {
  if (sbmFeedFilter.type !== 'all' && m.type !== sbmFeedFilter.type) return false;
  if (sbmFeedFilter.search) {
    var q = sbmFeedFilter.search;
    var inTitle = m.title.toLowerCase().indexOf(q) > -1;
    var inStreamer = (m.streamerIds || []).some(function (id) {
      var name = sbmStockNames[id];
      return name && name.toLowerCase().indexOf(q) > -1;
    });
    if (!inTitle && !inStreamer) return false;
  }
  return true;
}

function sbmRenderMarketFeed() {
  var heroSection = document.getElementById('feed-hero-section');
  var openSection = document.getElementById('feed-open-section');
  var closedPendingSection = document.getElementById('feed-closed-pending-section');
  var closedPendingGrid = document.getElementById('feed-closed-pending-grid');
  var pendingSection = document.getElementById('feed-pending-section');
  var emptyState = document.getElementById('feed-empty-state');
  var closedGrid = document.getElementById('closed-grid');
  if (!heroSection || !openSection || !pendingSection || !closedPendingSection) return;

  var rawOpen = [], rawPending = [], rawClosedPending = [], closed = [];
  Object.keys(sbmMarketsCache).forEach(function (id) {
    var m = sbmMarketsCache[id];
    if (m.status === 'open') rawOpen.push([id, m]);
    else if (m.status === 'pendingValidation') rawPending.push([id, m]);
    else if (m.status === 'closed') {
      // 06번 — 배팅 마감과 이벤트 마감은 별개. 이벤트가 아직 진행중이면 "진행중인 마켓"에 계속 노출하고,
      // 이벤트까지 끝난 뒤에야 "정산 대기중"으로 옮긴다.
      if (Date.now() < (m.timing.eventEndsAt || 0)) rawOpen.push([id, m]);
      else rawClosedPending.push([id, m]);
    }
    else if (m.status === 'settled' || m.status === 'void') closed.push([id, m]);
  });
  closed.sort(function (a, b) {
    var at = function (m) { return m.settlement ? m.settlement.settledAt : (m.adminAction ? m.adminAction.at : 0); };
    return at(b[1]) - at(a[1]);
  });

  var open = rawOpen.filter(function (e) { return sbmMatchesFilter(e[1]); });
  var pending = rawPending.filter(function (e) { return sbmMatchesFilter(e[1]); });
  var closedPending = rawClosedPending.filter(function (e) { return sbmMatchesFilter(e[1]); })
    .sort(function (a, b) { return a[1].timing.bettingClosesAt - b[1].timing.bettingClosesAt; });

  if (sbmFeedFilter.sort === 'popular') {
    open.sort(function (a, b) { return (b[1].totalPool || 0) - (a[1].totalPool || 0); });
  } else if (sbmFeedFilter.sort === 'newest') {
    open.sort(function (a, b) { return (b[1].timing.bettingOpensAt || 0) - (a[1].timing.bettingOpensAt || 0); });
  } else {
    open.sort(function (a, b) {
      var aClosed = a[1].status === 'closed', bClosed = b[1].status === 'closed';
      if (aClosed !== bClosed) return aClosed ? 1 : -1; // 아직 배팅 가능한 마켓이 먼저
      if (aClosed) return (a[1].timing.eventEndsAt || 0) - (b[1].timing.eventEndsAt || 0);
      return a[1].timing.bettingClosesAt - b[1].timing.bettingClosesAt;
    });
  }

  // 히어로(마감 임박)는 실제로 배팅 가능한 마켓 중에서만 뽑는다 — 배팅 마감된 마켓이 우연히
  // 정렬 맨 앞에 와도 "마감 임박" 히어로로 보여주지 않는다.
  var hero = (sbmFeedFilter.sort === 'closing' && open[0] && open[0][1].status === 'open') ? open[0] : null;
  var restOpen = hero ? open.slice(1) : open;

  var noMarketsAtAll = !rawOpen.length && !rawPending.length && !rawClosedPending.length;
  var noFilterMatch = !noMarketsAtAll && !hero && !restOpen.length && !pending.length && !closedPending.length;

  if (noMarketsAtAll) {
    heroSection.style.display = 'none';
    openSection.style.display = 'none';
    closedPendingSection.style.display = 'none';
    pendingSection.style.display = 'none';
    if (emptyState) emptyState.style.display = '';
  } else if (noFilterMatch) {
    if (emptyState) emptyState.style.display = 'none';
    heroSection.style.display = 'none';
    closedPendingSection.style.display = 'none';
    pendingSection.style.display = 'none';
    openSection.style.display = '';
    openSection.innerHTML = '<div class="admin-item-sub" style="padding:32px 0;text-align:center;">검색 · 필터 조건에 맞는 마켓이 없습니다.</div>';
  } else {
    if (emptyState) emptyState.style.display = 'none';
    heroSection.style.display = hero ? '' : 'none';
    heroSection.innerHTML = hero ? '<div class="section-label">마감 임박</div>' + sbmRenderOpenCard(hero[0], hero[1], true) : '';

    openSection.style.display = restOpen.length ? '' : 'none';
    openSection.innerHTML = restOpen.length
      ? '<div class="section-label">진행중인 마켓</div><div class="grid">' + restOpen.map(function (e) { return sbmRenderOpenCard(e[0], e[1], false); }).join('') + '</div>'
      : '';

    closedPendingSection.style.display = closedPending.length ? '' : 'none';
    if (closedPendingGrid) {
      closedPendingGrid.innerHTML = closedPending.map(function (e) { return sbmRenderClosedPendingCard(e[0], e[1]); }).join('');
    }

    pendingSection.style.display = pending.length ? '' : 'none';
    pendingSection.innerHTML = pending.length
      ? '<div class="section-label">대기중인 제안</div><div class="grid">' + pending.map(function (e) { return sbmRenderPendingCard(e[0], e[1]); }).join('') + '</div>'
      : '';
  }

  if (closedGrid) {
    closedGrid.innerHTML = closed.length
      ? closed.map(function (e) { return sbmRenderClosedCard(e[0], e[1]); }).join('')
      : '<div class="admin-item-sub">아직 마감된 마켓이 없습니다.</div>';
  }
  var sentinel = document.getElementById('load-sentinel');
  if (sentinel) sentinel.textContent = closed.length ? '모든 마켓을 확인했습니다' : '';

  sbmRenderAdminLists();
}

// 상단 스크롤 티커 — 최근 정산 결과를 우선 보여주고, 정산 이력이 없으면 진행중인 마켓의
// 실시간 배당으로 대체한다. 애니메이션(ticker-scroll)이 -50% 이동을 전제로 하므로
// 목록을 정확히 두 번 이어붙여야 끊김 없이 루프된다.
function sbmRenderTicker() {
  var track = document.getElementById('ticker-track');
  if (!track) return;

  var all = Object.keys(sbmMarketsCache).map(function (id) { return sbmMarketsCache[id]; });
  var settled = all.filter(function (m) { return m.status === 'settled' && m.settlement; })
    .sort(function (a, b) { return b.settlement.settledAt - a.settlement.settledAt; })
    .slice(0, 8);

  var source = settled.map(function (m) {
    var winLabel = (m.outcomes[m.settlement.winningOutcomeId] || {}).label || '';
    return { text: m.title + (winLabel ? ' · ' + winLabel + ' 적중' : ''), value: m.settlement.payoutMultiplier.toFixed(1) + 'x' };
  });

  if (!source.length) {
    source = all.filter(function (m) { return m.status === 'open'; }).slice(0, 8).map(function (m) {
      var odds = sbmComputeOdds(m);
      var firstId = Object.keys(m.outcomes)[0];
      return { text: m.title, value: (odds[firstId] || 0).toFixed(1) + 'x' };
    });
  }

  if (!source.length) {
    track.innerHTML = '<span>아직 하이라이트가 없습니다 · 첫 배팅 주제를 제안해보세요</span>';
    return;
  }

  var itemsHtml = source.map(function (item, i) {
    return '<span>' + item.text + ' <b class="' + (i % 2 === 0 ? 'up' : 'down') + ' num">' + item.value + '</b></span>';
  }).join('');
  track.innerHTML = itemsHtml + itemsHtml;
}

(function () {
  if (!window.sbmFirebase || !window.sbmDb) return;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/markets'), function (snap) {
    sbmMarketsCache = snap.val() || {};
    window.sbmMarketsCache = sbmMarketsCache;
    sbmRenderMarketFeed();
    sbmRenderTicker();
  });

  // 04번 — 좋아요 (다수결 라이트 검증), 재화가 걸려있지 않아 클라이언트가 직접 write
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-like-market');
    if (!btn) return;
    e.stopPropagation();
    if (!window.sbmRealUser) { window.sbmSignIn && window.sbmSignIn(); return; }
    var marketId = btn.getAttribute('data-market-id');
    fb.set(fb.ref(window.sbmDb, 'bettingMarket/likes/' + marketId + '/' + window.sbmRealUser.uid), true);
    btn.disabled = true;
    btn.textContent = '좋아요 완료';
  });

  var searchInput = document.getElementById('feed-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      sbmFeedFilter.search = searchInput.value.trim().toLowerCase();
      sbmRenderMarketFeed();
    });
  }
  var typeFilterEl = document.getElementById('feed-type-filter');
  if (typeFilterEl) {
    typeFilterEl.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        typeFilterEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        sbmFeedFilter.type = chip.getAttribute('data-type');
        sbmRenderMarketFeed();
      });
    });
  }
  var sortFilterEl = document.getElementById('feed-sort-filter');
  if (sortFilterEl) {
    sortFilterEl.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        sortFilterEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        sbmFeedFilter.sort = chip.getAttribute('data-sort');
        sbmRenderMarketFeed();
      });
    });
  }
})();

(function () {
  var el = document.getElementById('hero-timer');
  if (!el) return;
  setInterval(function () {
    var hero = document.querySelector('#feed-hero-section .js-manage-market');
    var marketId = hero && hero.getAttribute('data-market-id');
    var market = marketId && sbmMarketsCache[marketId];
    if (!market) return;
    var ms = market.timing.bettingClosesAt - Date.now();
    if (ms < 0) ms = 0;
    var m = Math.floor(ms / 60000);
    var s = Math.floor((ms % 60000) / 1000);
    var timerEl = document.getElementById('hero-timer');
    if (timerEl && timerEl.firstChild) {
      timerEl.firstChild.textContent = (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    }
  }, 1000);
})();
