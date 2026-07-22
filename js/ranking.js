// 13번 — 랭킹 탭. 서버(functions/src/rankings.js)가 5분마다 집계해 공개 노드에 기록한 결과를 읽기만 한다.
var sbmRankingsCache = null;

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

function sbmRenderRankings() {
  if (!sbmRankingsCache) return;
  var myUid = window.sbmUser ? window.sbmUser.uid : null;

  var assetEl = document.getElementById('ranking-list-asset');
  var winrateEl = document.getElementById('ranking-list-winrate');
  var profitEl = document.getElementById('ranking-list-profit');

  function toSortedArray(obj) {
    return Object.values(obj || {}).sort(function (a, b) { return a.rank - b.rank; });
  }

  if (assetEl) {
    var asset = toSortedArray(sbmRankingsCache.asset);
    assetEl.innerHTML = asset.length
      ? asset.map(function (e) {
          return sbmRenderRankingRow(e, myUid, '<span class="ranking-value">' + Math.round(e.value).toLocaleString('ko-KR') + '원</span>');
        }).join('')
      : '<div class="audit-empty">아직 랭킹 데이터가 없습니다.</div>';
  }

  if (winrateEl) {
    var winrate = toSortedArray(sbmRankingsCache.winrate);
    winrateEl.innerHTML = winrate.length
      ? winrate.map(function (e) {
          var sub = '<div class="ranking-sub">' + e.totalCount + '전 ' + e.winCount + '승</div>';
          return sbmRenderRankingRow(e, myUid, '<span class="ranking-value">' + e.value + '%</span>', sub);
        }).join('')
      : '<div class="audit-empty">아직 정산된 배팅이 없습니다.</div>';
  }

  if (profitEl) {
    var profit = toSortedArray(sbmRankingsCache.profit);
    profitEl.innerHTML = profit.length
      ? profit.map(function (e) {
          var cls = e.value > 0 ? 'positive' : e.value < 0 ? 'negative' : '';
          var sign = e.value > 0 ? '+' : '';
          return sbmRenderRankingRow(e, myUid, '<span class="ranking-value ' + cls + '">' + sign + Math.round(e.value).toLocaleString('ko-KR') + '원</span>');
        }).join('')
      : '<div class="audit-empty">아직 정산된 배팅이 없습니다.</div>';
  }

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
