(function () {
  var streamerOptions = []; // [{id, name}]

  if (window.sbmFirebase && window.sbmDb) {
    var fb = window.sbmFirebase;
    fb.get(fb.ref(window.sbmDb, 'stocks')).then(function (snap) {
      var val = snap.val() || {};
      streamerOptions = Object.keys(val).map(function (id) { return { id: id, name: val[id].name }; });
    });
  }

  var backdrop = document.getElementById('propose-backdrop');
  var closeBtn = document.getElementById('propose-modal-close');
  var typeSelect = document.getElementById('propose-type');
  var streamerFields = document.getElementById('propose-streamer-fields');
  var outcomeFields = document.getElementById('propose-outcome-fields');
  var titleInput = document.getElementById('propose-title');
  var betHoursInput = document.getElementById('propose-bet-hours');
  var eventHoursInput = document.getElementById('propose-event-hours');
  var betDateInput = document.getElementById('propose-bet-date');
  var eventDateInput = document.getElementById('propose-event-date');
  var betModeEl = document.getElementById('propose-bet-mode');
  var eventModeEl = document.getElementById('propose-event-mode');
  var betHoursRow = document.getElementById('propose-bet-hours-row');
  var betDateRow = document.getElementById('propose-bet-date-row');
  var eventHoursRow = document.getElementById('propose-event-hours-row');
  var eventDateRow = document.getElementById('propose-event-date-row');
  var errorEl = document.getElementById('propose-error');
  var submitBtn = document.getElementById('propose-submit-btn');
  var statusEl = document.getElementById('propose-status');
  if (!backdrop) return;

  var activePickers = [];
  var betMode = 'hours';
  var eventMode = 'hours';

  function toDatetimeLocalValue(ms) {
    var d = new Date(ms - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 16);
  }

  function setupDeadlineMode(modeEl, hoursRow, dateRow, onModeChange) {
    modeEl.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        modeEl.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        var mode = chip.getAttribute('data-mode');
        hoursRow.style.display = mode === 'hours' ? '' : 'none';
        dateRow.style.display = mode === 'date' ? '' : 'none';
        onModeChange(mode);
      });
    });
  }
  setupDeadlineMode(betModeEl, betHoursRow, betDateRow, function (m) { betMode = m; });
  setupDeadlineMode(eventModeEl, eventHoursRow, eventDateRow, function (m) { eventMode = m; });

  function createStreamerPicker(labelText, multi, otherPickerSelected) {
    var field = document.createElement('div');
    field.className = 'propose-field';
    var label = document.createElement('span');
    label.textContent = labelText;
    var picker = document.createElement('div');
    picker.className = 'streamer-picker';
    var chips = document.createElement('div');
    chips.className = 'streamer-chips';
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'streamer-search';
    input.placeholder = '스트리머 검색';
    input.autocomplete = 'off';
    var suggestions = document.createElement('div');
    suggestions.className = 'streamer-suggestions';

    var selected = []; // [{id, name}]

    function excluded() {
      var others = otherPickerSelected ? otherPickerSelected() : [];
      return selected.concat(others).map(function (s) { return s.id; });
    }

    function renderChips() {
      chips.innerHTML = selected.map(function (s) {
        return '<span class="streamer-chip">' + sbmEscapeHtml(s.name) + '<button type="button" class="chip-remove" data-id="' + s.id + '">×</button></span>';
      }).join('');
      chips.querySelectorAll('.chip-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selected = selected.filter(function (s) { return s.id !== btn.getAttribute('data-id'); });
          renderChips();
          updateInputState();
        });
      });
    }

    function updateInputState() {
      var full = !multi && selected.length >= 1;
      input.style.display = full ? 'none' : '';
      if (full) suggestions.style.display = 'none';
    }

    function renderSuggestions() {
      var q = input.value.trim();
      var excludedIds = excluded();
      var pool = streamerOptions.filter(function (s) {
        return excludedIds.indexOf(s.id) === -1 && (q === '' || s.name.indexOf(q) > -1);
      });
      if (!pool.length) { suggestions.innerHTML = '<div class="streamer-suggest-empty">일치하는 스트리머가 없어요</div>'; suggestions.style.display = 'block'; return; }
      suggestions.innerHTML = pool.map(function (s) {
        return '<button type="button" class="streamer-suggest-item" data-id="' + s.id + '" data-name="' + sbmEscapeHtml(s.name) + '">' + sbmEscapeHtml(s.name) + '</button>';
      }).join('');
      suggestions.style.display = 'block';
      suggestions.querySelectorAll('.streamer-suggest-item').forEach(function (btn) {
        btn.addEventListener('mousedown', function (e) {
          e.preventDefault();
          var s = { id: btn.getAttribute('data-id'), name: btn.getAttribute('data-name') };
          if (!multi) selected = [s];
          else if (selected.map(function (x) { return x.id; }).indexOf(s.id) === -1) selected.push(s);
          input.value = '';
          renderChips();
          updateInputState();
          renderSuggestions();
          if (multi || !selected.length) input.focus();
        });
      });
    }

    input.addEventListener('input', renderSuggestions);
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('blur', function () {
      setTimeout(function () { suggestions.style.display = 'none'; }, 120);
    });

    picker.appendChild(chips);
    picker.appendChild(input);
    picker.appendChild(suggestions);
    field.appendChild(label);
    field.appendChild(picker);

    renderChips();
    updateInputState();

    return {
      el: field,
      getSelected: function () { return selected.slice(); },
      refresh: renderSuggestions,
    };
  }

  function renderStreamerFields(type) {
    streamerFields.innerHTML = '';
    activePickers = [];

    if (type === 'personal') {
      var p1 = createStreamerPicker('참가 스트리머', false, null);
      streamerFields.appendChild(p1.el);
      activePickers.push(p1);
    } else if (type === '1v1') {
      var a, b;
      a = createStreamerPicker('스트리머 A', false, function () { return b.getSelected(); });
      b = createStreamerPicker('스트리머 B', false, function () { return a.getSelected(); });
      streamerFields.appendChild(a.el);
      streamerFields.appendChild(b.el);
      activePickers.push(a, b);
    } else {
      var g = createStreamerPicker('참가 스트리머 (2명 이상 선택)', true, null);
      streamerFields.appendChild(g.el);
      activePickers.push(g);
    }
  }

  function getSelectedStreamerIds() {
    var all = [];
    activePickers.forEach(function (p) { all = all.concat(p.getSelected().map(function (s) { return s.id; })); });
    return all;
  }

  // 03번 — 개인전은 기본이 성공/실패 이진이지만, 등급 승급처럼 결과가 2개로 안 떨어지는
  // 주제도 있어서 직접 입력한 2~4개 선택지로 대체할 수 있게 한다. 1vs1 · 단체전은
  // 이미 "누가 이기는가" 구조 자체가 선택지라 커스텀을 열지 않는다.
  var customModeOn = false;
  var customOutcomeLabels = ['', ''];

  function renderOutcomeFields(type) {
    outcomeFields.innerHTML = '';
    customModeOn = false;
    customOutcomeLabels = ['', ''];
    if (type !== 'personal') return;

    var field = document.createElement('div');
    field.className = 'propose-field';
    var toggleLabel = document.createElement('label');
    toggleLabel.className = 'propose-outcome-toggle';
    toggleLabel.innerHTML = '<input type="checkbox">성공/실패 대신 선택지를 직접 입력할게요 (2~4개)';
    var inputsWrap = document.createElement('div');
    inputsWrap.style.display = 'none';
    field.appendChild(toggleLabel);
    field.appendChild(inputsWrap);
    outcomeFields.appendChild(field);

    function renderInputs() {
      inputsWrap.innerHTML = customOutcomeLabels.map(function (val, i) {
        return '<div class="propose-outcome-row">' +
          '<input type="text" class="propose-outcome-input" data-index="' + i + '" maxlength="20" placeholder="선택지 ' + (i + 1) + '" value="' + sbmEscapeHtml(val || '') + '">' +
          (customOutcomeLabels.length > 2 ? '<button type="button" class="propose-outcome-remove" data-index="' + i + '">×</button>' : '') +
          '</div>';
      }).join('') +
      (customOutcomeLabels.length < 4 ? '<button type="button" class="propose-outcome-add">+ 선택지 추가</button>' : '');

      inputsWrap.querySelectorAll('.propose-outcome-input').forEach(function (inp) {
        inp.addEventListener('input', function () {
          customOutcomeLabels[parseInt(inp.getAttribute('data-index'), 10)] = inp.value;
        });
      });
      inputsWrap.querySelectorAll('.propose-outcome-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          customOutcomeLabels.splice(parseInt(btn.getAttribute('data-index'), 10), 1);
          renderInputs();
        });
      });
      var addBtn = inputsWrap.querySelector('.propose-outcome-add');
      if (addBtn) {
        addBtn.addEventListener('click', function () {
          customOutcomeLabels.push('');
          renderInputs();
        });
      }
    }

    toggleLabel.querySelector('input').addEventListener('change', function (e) {
      customModeOn = e.target.checked;
      inputsWrap.style.display = customModeOn ? '' : 'none';
      if (customModeOn) renderInputs();
    });
  }

  var TITLE_PLACEHOLDERS = {
    personal: '예: 스트리머 OO가 노래대회에서 3등 이상',
    '1v1': '예: 스트리머 OO와 XX, 이번 대결에서 누가 이길까?',
    group: '예: OO 대회에서 1등 예측하기',
  };
  function updateTitlePlaceholder() {
    titleInput.placeholder = TITLE_PLACEHOLDERS[typeSelect.value] || '';
  }

  function resetForm() {
    typeSelect.value = 'personal';
    renderStreamerFields('personal');
    renderOutcomeFields('personal');
    updateTitlePlaceholder();
    titleInput.value = '';
    betHoursInput.value = '24';
    eventHoursInput.value = '0';
    var nowMinute = toDatetimeLocalValue(Date.now() + 60000);
    betDateInput.min = nowMinute;
    betDateInput.value = toDatetimeLocalValue(Date.now() + 24 * 3600000);
    eventDateInput.min = nowMinute;
    eventDateInput.value = toDatetimeLocalValue(Date.now() + 24 * 3600000);
    betMode = 'hours';
    eventMode = 'hours';
    betModeEl.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('active', c.getAttribute('data-mode') === 'hours'); });
    eventModeEl.querySelectorAll('.chip').forEach(function (c) { c.classList.toggle('active', c.getAttribute('data-mode') === 'hours'); });
    betHoursRow.style.display = '';
    betDateRow.style.display = 'none';
    eventHoursRow.style.display = '';
    eventDateRow.style.display = 'none';
    titleInput.disabled = false;
    betHoursInput.disabled = false;
    eventHoursInput.disabled = false;
    betDateInput.disabled = false;
    eventDateInput.disabled = false;
    typeSelect.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '제안하기';
    errorEl.classList.remove('show');
    statusEl.classList.remove('show');
  }

  function openModal() {
    if (!window.sbmUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    resetForm();
    backdrop.classList.add('open');
    titleInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }

  var fab = document.querySelector('.fab');
  if (fab) fab.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
  typeSelect.addEventListener('change', function () {
    renderStreamerFields(typeSelect.value);
    renderOutcomeFields(typeSelect.value);
    updateTitlePlaceholder();
  });
  renderStreamerFields('personal');
  renderOutcomeFields('personal');

  submitBtn.addEventListener('click', function () {
    if (!window.sbmUser) {
      errorEl.textContent = '제안하려면 로그인이 필요합니다 (Ctrl+Enter).';
      errorEl.classList.add('show');
      return;
    }
    var streamers = getSelectedStreamerIds();
    var uniqueOk = new Set(streamers).size === streamers.length;

    var now = Date.now();
    var betHours;
    if (betMode === 'date') {
      var betDateMs = betDateInput.value ? new Date(betDateInput.value).getTime() : NaN;
      if (isNaN(betDateMs) || betDateMs <= now) {
        errorEl.textContent = '배팅 마감 날짜·시각은 지금보다 이후여야 합니다.';
        errorEl.classList.add('show');
        return;
      }
      betHours = Math.max(1, Math.ceil((betDateMs - now) / 3600000));
    } else {
      betHours = parseInt(betHoursInput.value, 10);
    }
    var bettingClosesAtEstimate = now + betHours * 3600000;

    var eventHours;
    if (eventMode === 'date') {
      var eventDateMs = eventDateInput.value ? new Date(eventDateInput.value).getTime() : NaN;
      if (isNaN(eventDateMs) || eventDateMs < bettingClosesAtEstimate) {
        errorEl.textContent = '이벤트 마감 날짜·시각은 배팅 마감 시점보다 이후여야 합니다.';
        errorEl.classList.add('show');
        return;
      }
      eventHours = Math.max(0, Math.ceil((eventDateMs - bettingClosesAtEstimate) / 3600000));
    } else {
      eventHours = parseInt(eventHoursInput.value, 10);
    }

    if (!titleInput.value.trim() || !betHours || betHours < 1 || isNaN(eventHours) || eventHours < 0 ||
        streamers.length < 1 || !uniqueOk ||
        (typeSelect.value === '1v1' && streamers.length !== 2) ||
        (typeSelect.value === 'group' && streamers.length < 2)) {
      errorEl.textContent = '모든 항목을 입력하고, 참가 스트리머가 중복 없이 선택됐는지 확인해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    var outcomeLabels = null;
    if (typeSelect.value === 'personal' && customModeOn) {
      var cleaned = customOutcomeLabels.map(function (s) { return (s || '').trim(); }).filter(Boolean);
      var dedupOk = new Set(cleaned).size === cleaned.length;
      if (cleaned.length < 2 || cleaned.length > 4 || !dedupOk) {
        errorEl.textContent = '선택지는 중복 없이 2개 이상 4개 이하로 입력해 주세요.';
        errorEl.classList.add('show');
        return;
      }
      outcomeLabels = cleaned;
    }
    errorEl.classList.remove('show');
    typeSelect.disabled = true;
    titleInput.disabled = true;
    betHoursInput.disabled = true;
    eventHoursInput.disabled = true;
    betDateInput.disabled = true;
    eventDateInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '제안 처리중...';

    window.sbmFirebase.httpsCallable('submitMarketProposal')({
      title: titleInput.value.trim(),
      type: typeSelect.value,
      streamerIds: streamers,
      betHours: betHours,
      eventHours: eventHours,
      outcomeLabels: outcomeLabels,
    }).then(function (res) {
      submitBtn.textContent = '제안 완료';
      statusEl.style.color = 'var(--mint)';
      statusEl.textContent = res.data.status === 'open'
        ? '관리자 · 인증 스트리머 계정으로 제안해 검증 단계 없이 즉시 배팅이 오픈됩니다.'
        : '제안이 접수됐습니다. 관리자 · 인증 스트리머 검증 또는 좋아요 20개 이상 중 먼저 충족되는 조건으로 자동 오픈됩니다.';
      statusEl.classList.add('show');
    }).catch(function (err) {
      typeSelect.disabled = false;
      titleInput.disabled = false;
      betHoursInput.disabled = false;
      eventHoursInput.disabled = false;
      betDateInput.disabled = false;
      eventDateInput.disabled = false;
      submitBtn.disabled = false;
      submitBtn.textContent = '제안하기';
      errorEl.textContent = err.message || '제안 처리 중 오류가 발생했습니다.';
      errorEl.classList.add('show');
    });
  });
})();
