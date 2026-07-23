// 13번 — 랭킹 탭. 서버(functions/src/rankings.js)가 5분마다 집계해 공개 노드에 기록한 결과를 읽기만 한다.
// 서버가 이미 상위 100명까지만 보내주지만(RANKING_DISPLAY_CAP), 화면에는 한 번에 20명씩만
// 그리고 "더보기"를 누를 때마다 20명씩 추가로 펼쳐서 렌더링 비용을 줄인다.
var sbmRankingsCache = null;
var SBM_RANKING_PAGE_SIZE = 20;
var sbmRankingShown = { asset: SBM_RANKING_PAGE_SIZE, winrate: SBM_RANKING_PAGE_SIZE, profit: SBM_RANKING_PAGE_SIZE };

function sbmRankAvatarHtml(entry) {
  if (entry.avatarUrl) {
    return '<span class="ravatar-initial" style="display:none;"></span><img class="ravatar-img" src="' + sbmEscapeHtml(entry.avatarUrl) + '" alt="">';
  }
  var initial = (entry.nickname || '?').charAt(0);
  return '<span class="ravatar-initial">' + sbmEscapeHtml(initial) + '</span><img class="ravatar-img" style="display:none;" alt="">';
}

function sbmRankBadge(rank) {
  if (rank === 1) return '<span class="ranking-rank gold">1</span>';
  if (rank === 2) return '<span class="ranking-rank silver">2</span>';
  if (rank === 3) return '<span class="ranking-rank bronze">3</span>';
  return '<span class="ranking-rank">' + rank + '</span>';
}

function sbmRenderRankingRow(entry, myUid, valueHtml, subHtml) {
  var isMe = entry.uid === myUid;
  var reportBtn = isMe ? '' :
    '<button class="ranking-report-btn js-open-nick-report" data-id="' + entry.uid + '" data-nickname="' + sbmEscapeHtml(entry.nickname) + '" type="button" title="닉네임 신고">신고</button>';
  return '<div class="ranking-row' + (isMe ? ' me' : '') + '" data-id="' + entry.uid + '">' +
    sbmRankBadge(entry.rank) +
    '<span class="ranking-avatar" data-id="' + entry.uid + '">' + sbmRankAvatarHtml(entry) + '</span>' +
    '<span class="ranking-name">' + sbmEscapeHtml(entry.nickname) + (isMe ? '<span class="me-tag">나</span>' : '') + '</span>' +
    valueHtml +
    (subHtml || '') +
    reportBtn +
    '</div>';
}

function sbmRenderRankingList(el, type, sorted, emptyMsg, rowFn) {
  if (!el) return;
  if (!sorted.length) {
    el.innerHTML = '<div class="audit-empty">' + emptyMsg + '</div>';
    return;
  }
  var shown = Math.min(sbmRankingShown[type], sorted.length);
  var html = sorted.slice(0, shown).map(rowFn).join('');
  if (shown < sorted.length) {
    html += '<button class="ranking-more-btn" data-type="' + type + '" type="button">더보기 (' + shown + ' / ' + sorted.length + ')</button>';
  }
  el.innerHTML = html;
  var moreBtn = el.querySelector('.ranking-more-btn');
  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      sbmRankingShown[type] += SBM_RANKING_PAGE_SIZE;
      sbmRenderRankings();
    });
  }
}

function sbmRenderRankings() {
  if (!sbmRankingsCache) return;
  var myUid = window.sbmUser ? window.sbmUser.uid : null;

  var assetEl = document.getElementById('ranking-list-asset');
  var winrateEl = document.getElementById('ranking-list-winrate');
  var profitEl = document.getElementById('ranking-list-profit');

  function toSortedArray(obj) {
    return Object.values(obj || {}).sort(function (a, b) { return a.rank - b.rank; });
  }

  sbmRenderRankingList(assetEl, 'asset', toSortedArray(sbmRankingsCache.asset), '아직 랭킹 데이터가 없습니다.', function (e) {
    return sbmRenderRankingRow(e, myUid, '<span class="ranking-value">' + Math.round(e.value).toLocaleString('ko-KR') + '원</span>');
  });

  sbmRenderRankingList(winrateEl, 'winrate', toSortedArray(sbmRankingsCache.winrate), '아직 정산된 배팅이 없습니다.', function (e) {
    var sub = '<div class="ranking-sub">' + e.totalCount + '전 ' + e.winCount + '승</div>';
    return sbmRenderRankingRow(e, myUid, '<span class="ranking-value">' + e.value + '%</span>', sub);
  });

  sbmRenderRankingList(profitEl, 'profit', toSortedArray(sbmRankingsCache.profit), '아직 정산된 배팅이 없습니다.', function (e) {
    var cls = e.value > 0 ? 'positive' : e.value < 0 ? 'negative' : '';
    var sign = e.value > 0 ? '+' : '';
    return sbmRenderRankingRow(e, myUid, '<span class="ranking-value ' + cls + '">' + sign + Math.round(e.value).toLocaleString('ko-KR') + '원</span>');
  });

  if (typeof sbmReapplyNicknameBlocks === 'function') sbmReapplyNicknameBlocks();
}

(function () {
  if (!window.sbmFirebase) return;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/rankings'), function (snap) {
    sbmRankingsCache = snap.val() || {};
    sbmRenderRankings();
  });
  document.addEventListener('sbm-auth-changed', sbmRenderRankings);
})();
