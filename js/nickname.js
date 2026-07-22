var NICKNAME_REPORT_REASONS = ['부적절한 표현', '사칭 · 도용', '광고 · 스팸성 닉네임', '기타'];

var sbmBlockedNicknamesCache = {};
var sbmBlockSubscribed = false;
var sbmNickReportSubscribed = false;

// 13번 — 차단된 닉네임은 랭킹에서 즉시 숨김. 랭킹 목록이 다시 그려질 때마다(ranking.js)
// 구독을 새로 걸지 않고 이미 받아온 캐시로 즉시 재적용할 수 있게 분리해둔다.
function sbmReapplyNicknameBlocks() {
  document.querySelectorAll('.ranking-row[data-id]').forEach(function (row) {
    var id = row.getAttribute('data-id');
    row.classList.toggle('blocked', !!sbmBlockedNicknamesCache[id]);
  });
}

function sbmApplyNicknameBlocks() {
  if (sbmBlockSubscribed || !window.sbmFirebase) return;
  sbmBlockSubscribed = true;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/blockedNicknames'), function (snap) {
    sbmBlockedNicknamesCache = snap.val() || {};
    sbmReapplyNicknameBlocks();
  });
}

function sbmRenderNicknameReportQueue() {
  var list = document.getElementById('nick-report-queue-list');
  if (!list || sbmNickReportSubscribed || !window.sbmFirebase) return;
  sbmNickReportSubscribed = true;
  var fb = window.sbmFirebase;

  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/nicknameReports'), function (snap) {
    var val = snap.val() || {};
    var reports = Object.keys(val).map(function (id) { return Object.assign({ id: id }, val[id]); })
      .sort(function (a, b) { return b.reportedAt - a.reportedAt; });
    if (!reports.length) {
      list.innerHTML = '<li class="audit-empty">접수된 닉네임 신고가 없습니다.</li>';
      return;
    }
    list.innerHTML = reports.map(function (r) {
      return '<li class="report-queue-item">' +
        '<div class="report-queue-head"><span class="report-queue-title">' + sbmEscapeHtml(r.nickname) + '</span><span class="report-queue-meta">' + sbmEscapeHtml(r.reason) + '</span></div>' +
        (r.detail ? '<div class="report-queue-detail">' + sbmEscapeHtml(r.detail) + '</div>' : '') +
        '<div class="audit-time">' + new Date(r.reportedAt).toLocaleString('ko-KR') + '</div>' +
        '<div class="report-queue-actions">' +
        '<button class="report-queue-view-btn nick-block-btn" data-report-id="' + r.id + '" type="button">차단</button>' +
        '<button class="report-queue-dismiss-btn nick-dismiss-btn" data-report-id="' + r.id + '" type="button">무시</button>' +
        '</div></li>';
    }).join('');

    list.querySelectorAll('.nick-block-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fb.httpsCallable('blockNickname')({ reportId: btn.getAttribute('data-report-id') })
          .catch(function (e) { alert(e.message); btn.disabled = false; });
      });
    });
    list.querySelectorAll('.nick-dismiss-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        fb.remove(fb.ref(window.sbmDb, 'bettingMarket/nicknameReports/' + btn.getAttribute('data-report-id')));
      });
    });
  });
}

function sbmRenderBlockedNicknames() {
  var list = document.getElementById('blocked-nick-list');
  if (!list || !window.sbmFirebase) return;
  var fb = window.sbmFirebase;
  fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/blockedNicknames'), function (snap) {
    var val = snap.val() || {};
    var blocked = Object.keys(val).map(function (id) { return Object.assign({ id: id }, val[id]); });
    if (!blocked.length) {
      list.innerHTML = '<li class="audit-empty">차단된 닉네임이 없습니다.</li>';
      return;
    }
    list.innerHTML = blocked.map(function (b) {
      return '<li class="verify-req-item">' +
        '<div class="verify-req-info"><b>' + sbmEscapeHtml(b.nickname) + '</b><span>차단: ' + new Date(b.blockedAt).toLocaleString('ko-KR') + ' · ' + sbmEscapeHtml(b.blockedByName) + '</span></div>' +
        '<div class="verify-req-actions">' +
        '<button class="verify-req-approve nick-unblock-btn" data-id="' + b.id + '" type="button">차단 해제</button>' +
        '</div></li>';
    }).join('');

    list.querySelectorAll('.nick-unblock-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fb.httpsCallable('unblockNickname')({ targetId: btn.getAttribute('data-id') })
          .catch(function (e) { alert(e.message); btn.disabled = false; });
      });
    });
  });
}

(function () {
  var backdrop = document.getElementById('nick-report-backdrop');
  var closeBtn = document.getElementById('nick-report-modal-close');
  var targetNameEl = document.getElementById('nick-report-target-name');
  var reasonSelect = document.getElementById('nick-report-reason');
  var detailInput = document.getElementById('nick-report-detail');
  var submitBtn = document.getElementById('nick-report-submit-btn');
  var statusEl = document.getElementById('nick-report-status');
  if (!backdrop) return;

  var currentId = '';
  var currentName = '';

  function openModal(id, name) {
    currentId = id;
    currentName = name;
    targetNameEl.textContent = name;
    reasonSelect.innerHTML = '';
    NICKNAME_REPORT_REASONS.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      reasonSelect.appendChild(opt);
    });
    detailInput.value = '';
    detailInput.disabled = false;
    reasonSelect.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '신고하기';
    statusEl.classList.remove('show');
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.js-open-nick-report');
    if (!btn) return;
    e.stopPropagation();
    openModal(btn.getAttribute('data-id'), btn.getAttribute('data-nickname'));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  submitBtn.addEventListener('click', function () {
    if (!window.sbmFirebase) return;
    reasonSelect.disabled = true;
    detailInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '신고 처리중...';
    window.sbmFirebase.httpsCallable('reportNickname')({
      targetId: currentId,
      nickname: currentName,
      reason: reasonSelect.value,
      detail: detailInput.value.trim(),
    }).then(function () {
      submitBtn.textContent = '신고 완료';
      statusEl.style.color = 'var(--mint)';
      statusEl.textContent = '신고가 접수됐습니다. 관리자 · 인증 스트리머가 확인 후 처리합니다.';
      statusEl.classList.add('show');
    }).catch(function (err) {
      submitBtn.disabled = false;
      reasonSelect.disabled = false;
      detailInput.disabled = false;
      submitBtn.textContent = '신고하기';
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = err.message || '신고 처리 중 오류가 발생했습니다.';
      statusEl.classList.add('show');
    });
  });
})();
