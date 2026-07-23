(function () {
  var ACTION_LABEL = { closeEarly: '조기 마감', void: '무효 처리' };
  var CLOSE_REASONS = ['이벤트가 예정보다 일찍 종료됨', '스트리머 방송 종료', '어뷰징 의심으로 조기 마감'].concat(PROHIBITED_TOPIC_REASONS, ['기타']);
  var VOID_REASONS = ['최소 참여 인원 미달', '이벤트 자체 무산', '주제 오류 · 판정 불가', '어뷰징 적발'].concat(PROHIBITED_TOPIC_REASONS, ['기타']);

  var backdrop = document.getElementById('manage-backdrop');
  var closeBtn = document.getElementById('manage-modal-close');
  var titleEl = document.getElementById('manage-modal-title');
  var outcomesEl = document.getElementById('manage-outcomes');
  var confirmBtn = document.getElementById('manage-confirm-btn');
  var cancelJudgmentBtn = document.getElementById('manage-cancel-judgment-btn');
  var closeEarlyBtn = document.getElementById('manage-close-early-btn');
  var voidBtn = document.getElementById('manage-void-btn');
  var statusEl = document.getElementById('manage-status');
  var reasonPanel = document.getElementById('manage-reason-panel');
  var reasonLabel = document.getElementById('manage-reason-label');
  var reasonSelect = document.getElementById('manage-reason-select');
  var reasonActor = document.getElementById('manage-reason-actor');
  var reasonConfirmBtn = document.getElementById('manage-reason-confirm');
  var reasonCancelBtn = document.getElementById('manage-reason-cancel');
  var overrideParticipantsCheckbox = document.getElementById('manage-override-participants');
  if (!backdrop) return;

  var currentMarketId = '';
  var selectedOutcomeId = '';
  var pendingAction = null;
  var judgeCountdownTimer = null;

  function renderOutcomes(market, preselectId) {
    var odds = window.sbmComputeOdds(market);
    outcomesEl.innerHTML = '';
    Object.keys(market.outcomes).forEach(function (id, i) {
      var o = market.outcomes[id];
      var isSelected = preselectId ? id === preselectId : i === 0;
      var label = document.createElement('label');
      label.className = 'bet-outcome-option' + (isSelected ? ' selected' : '');
      label.innerHTML =
        '<span class="label"><input type="radio" name="manage-outcome" ' + (isSelected ? 'checked' : '') + '>' + sbmEscapeHtml(o.label) + '</span>' +
        '<span class="odd num">' + (odds[id] ? odds[id].toFixed(2) : '-') + 'x</span>';
      label.querySelector('input').addEventListener('change', function () {
        outcomesEl.querySelectorAll('.bet-outcome-option').forEach(function (el) { el.classList.remove('selected'); });
        label.classList.add('selected');
        selectedOutcomeId = id;
      });
      outcomesEl.appendChild(label);
    });
    selectedOutcomeId = preselectId || Object.keys(market.outcomes)[0];
  }

  function stopJudgeCountdown() {
    if (judgeCountdownTimer) { clearInterval(judgeCountdownTimer); judgeCountdownTimer = null; }
  }

  function startJudgeCountdown(finalizeAt) {
    stopJudgeCountdown();
    function tick() {
      var remaining = Math.max(0, Math.round((finalizeAt - Date.now()) / 1000));
      statusEl.style.color = 'var(--gold)';
      statusEl.textContent = '판정이 접수됐습니다. ' + remaining + '초 후 자동 확정됩니다. 그 전까지 다시 판정하거나 취소할 수 있어요.';
      statusEl.classList.add('show');
      if (remaining <= 0) {
        stopJudgeCountdown();
        statusEl.textContent = '판정이 확정 처리되었습니다.';
        cancelJudgmentBtn.style.display = 'none';
      }
    }
    tick();
    judgeCountdownTimer = setInterval(tick, 1000);
  }

  function resetActions() {
    var canManage = window.sbmIsAdmin || window.sbmIsVerifiedStreamer;
    confirmBtn.disabled = !canManage;
    closeEarlyBtn.disabled = !canManage;
    voidBtn.disabled = !canManage;
    overrideParticipantsCheckbox.disabled = !canManage;
    cancelJudgmentBtn.style.display = 'none';
    cancelJudgmentBtn.disabled = !canManage;
    confirmBtn.textContent = '판정하기';
    stopJudgeCountdown();
    statusEl.classList.remove('show');
    if (!canManage) {
      statusEl.style.color = 'var(--coral)';
      statusEl.textContent = '관리자 또는 인증 스트리머만 마켓을 관리할 수 있습니다.';
      statusEl.classList.add('show');
    }
    reasonPanel.classList.remove('show');
    pendingAction = null;
  }

  function openModal(marketId) {
    var market = window.sbmMarketsCache[marketId];
    if (!market) return;
    currentMarketId = marketId;
    titleEl.textContent = market.title;
    resetActions();
    if (market.status === 'pendingSettlement' && market.pendingSettlement) {
      renderOutcomes(market, market.pendingSettlement.winningOutcomeId);
      confirmBtn.textContent = '판정 변경';
      if (window.sbmIsAdmin || window.sbmIsVerifiedStreamer) cancelJudgmentBtn.style.display = '';
      startJudgeCountdown(market.pendingSettlement.finalizeAt);
    } else {
      renderOutcomes(market);
    }
    overrideParticipantsCheckbox.checked = !!market.minParticipantsOverride;
    backdrop.classList.add('open');
  }
  function closeModal() { backdrop.classList.remove('open'); stopJudgeCountdown(); }

  document.addEventListener('click', function (e) {
    var card = e.target.closest('.js-manage-market');
    if (!card || e.target.closest('.stub-foot-actions')) return;
    if (!window.sbmIsAdmin && !window.sbmIsVerifiedStreamer) return;
    openModal(card.getAttribute('data-market-id'));
  });
  document.addEventListener('sbm-auth-changed', function () {
    document.body.classList.toggle('sbm-can-manage', !!(window.sbmIsAdmin || window.sbmIsVerifiedStreamer));
  });
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  function openReasonPanel(action) {
    pendingAction = action;
    var reasons = action === 'closeEarly' ? CLOSE_REASONS : VOID_REASONS;
    reasonLabel.textContent = ACTION_LABEL[action] + ' 사유 선택';
    reasonSelect.innerHTML = '';

    var opGroup = document.createElement('optgroup');
    opGroup.label = '운영 사유';
    var policyGroup = document.createElement('optgroup');
    policyGroup.label = '금지 주제 위반';

    reasons.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r;
      opt.textContent = r;
      if (PROHIBITED_TOPIC_REASONS.indexOf(r) > -1) policyGroup.appendChild(opt);
      else opGroup.appendChild(opt);
    });
    reasonSelect.appendChild(opGroup);
    reasonSelect.appendChild(policyGroup);

    reasonActor.textContent = '처리자: ' + sbmActorLabel() + ' · ' + new Date().toLocaleString('ko-KR');
    reasonPanel.classList.add('show');
  }

  overrideParticipantsCheckbox.addEventListener('change', function () {
    if (!window.sbmFirebase || !currentMarketId) return;
    var checked = overrideParticipantsCheckbox.checked;
    overrideParticipantsCheckbox.disabled = true;
    window.sbmFirebase.httpsCallable('setMinParticipantsOverride')({ marketId: currentMarketId, override: checked })
      .then(function () {
        overrideParticipantsCheckbox.disabled = false;
      })
      .catch(function (e) {
        alert(e.message);
        overrideParticipantsCheckbox.checked = !checked;
        overrideParticipantsCheckbox.disabled = false;
      });
  });

  confirmBtn.addEventListener('click', function () {
    if (!window.sbmFirebase || !selectedOutcomeId) return;
    stopJudgeCountdown();
    confirmBtn.disabled = true;
    closeEarlyBtn.disabled = true;
    voidBtn.disabled = true;
    cancelJudgmentBtn.disabled = true;
    statusEl.style.color = 'var(--gold)';
    statusEl.textContent = '판정 처리중...';
    statusEl.classList.add('show');
    window.sbmFirebase.httpsCallable('judgeMarket')({ marketId: currentMarketId, winningOutcomeId: selectedOutcomeId })
      .then(function (res) {
        confirmBtn.disabled = false;
        closeEarlyBtn.disabled = false;
        voidBtn.disabled = false;
        cancelJudgmentBtn.disabled = false;
        confirmBtn.textContent = '판정 변경';
        cancelJudgmentBtn.style.display = '';
        startJudgeCountdown(res.data.finalizeAt);
      })
      .catch(function (err) {
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '판정 처리 중 오류가 발생했습니다.';
        confirmBtn.disabled = false;
        closeEarlyBtn.disabled = false;
        voidBtn.disabled = false;
        cancelJudgmentBtn.disabled = false;
      });
  });
  cancelJudgmentBtn.addEventListener('click', function () {
    if (!window.sbmFirebase) return;
    stopJudgeCountdown();
    cancelJudgmentBtn.disabled = true;
    confirmBtn.disabled = true;
    statusEl.style.color = 'var(--gold)';
    statusEl.textContent = '판정 취소 처리중...';
    statusEl.classList.add('show');
    window.sbmFirebase.httpsCallable('cancelPendingJudgment')({ marketId: currentMarketId })
      .then(function () {
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = '판정이 취소됐습니다. 다시 판정할 수 있습니다.';
        confirmBtn.disabled = false;
        confirmBtn.textContent = '판정하기';
        cancelJudgmentBtn.style.display = 'none';
      })
      .catch(function (err) {
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '판정 취소 중 오류가 발생했습니다.';
        confirmBtn.disabled = false;
        cancelJudgmentBtn.disabled = false;
      });
  });
  closeEarlyBtn.addEventListener('click', function () { openReasonPanel('closeEarly'); });
  voidBtn.addEventListener('click', function () { openReasonPanel('void'); });

  reasonCancelBtn.addEventListener('click', function () {
    reasonPanel.classList.remove('show');
    pendingAction = null;
  });

  reasonConfirmBtn.addEventListener('click', function () {
    if (!window.sbmFirebase) return;
    var reason = reasonSelect.value;
    var action = pendingAction;
    confirmBtn.disabled = true;
    closeEarlyBtn.disabled = true;
    voidBtn.disabled = true;
    reasonPanel.classList.remove('show');
    statusEl.style.color = 'var(--gold)';
    statusEl.textContent = '처리중...';
    statusEl.classList.add('show');

    var fnName = action === 'closeEarly' ? 'closeMarketEarly' : 'voidMarket';
    window.sbmFirebase.httpsCallable(fnName)({ marketId: currentMarketId, reason: reason })
      .then(function () {
        statusEl.style.color = action === 'closeEarly' ? 'var(--gold)' : 'var(--coral)';
        statusEl.textContent = action === 'closeEarly'
          ? '배팅이 지금 즉시 마감됐습니다. 사유: ' + reason
          : '무효 처리됐습니다. 참가자 전원에게 배팅 원금이 환불됩니다. 사유: ' + reason;
      })
      .catch(function (err) {
        statusEl.style.color = 'var(--coral)';
        statusEl.textContent = err.message || '처리 중 오류가 발생했습니다.';
        confirmBtn.disabled = false;
        closeEarlyBtn.disabled = false;
        voidBtn.disabled = false;
      });
  });
})();
