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
  var titleInput = document.getElementById('propose-title');
  var betHoursInput = document.getElementById('propose-bet-hours');
  var eventHoursInput = document.getElementById('propose-event-hours');
  var errorEl = document.getElementById('propose-error');
  var submitBtn = document.getElementById('propose-submit-btn');
  var statusEl = document.getElementById('propose-status');
  if (!backdrop) return;

  var activePickers = [];

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
        return '<span class="streamer-chip">' + s.name + '<button type="button" class="chip-remove" data-id="' + s.id + '">×</button></span>';
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
        return '<button type="button" class="streamer-suggest-item" data-id="' + s.id + '" data-name="' + s.name + '">' + s.name + '</button>';
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
    updateTitlePlaceholder();
    titleInput.value = '';
    betHoursInput.value = '24';
    eventHoursInput.value = '0';
    titleInput.disabled = false;
    betHoursInput.disabled = false;
    eventHoursInput.disabled = false;
    typeSelect.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '제안하기';
    errorEl.classList.remove('show');
    statusEl.classList.remove('show');
  }

  function openModal() {
    resetForm();
    backdrop.classList.add('open');
    titleInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }

  var fab = document.querySelector('.fab');
  if (fab) fab.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });
  typeSelect.addEventListener('change', function () { renderStreamerFields(typeSelect.value); updateTitlePlaceholder(); });
  renderStreamerFields('personal');

  submitBtn.addEventListener('click', function () {
    if (!window.sbmRealUser) {
      errorEl.textContent = '제안하려면 로그인이 필요합니다 (Ctrl+Enter).';
      errorEl.classList.add('show');
      return;
    }
    var streamers = getSelectedStreamerIds();
    var uniqueOk = new Set(streamers).size === streamers.length;
    var betHours = parseInt(betHoursInput.value, 10);
    var eventHours = parseInt(eventHoursInput.value, 10);
    if (!titleInput.value.trim() || !betHours || betHours < 1 || isNaN(eventHours) || eventHours < 0 ||
        streamers.length < 1 || !uniqueOk ||
        (typeSelect.value === '1v1' && streamers.length !== 2) ||
        (typeSelect.value === 'group' && streamers.length < 2)) {
      errorEl.textContent = '모든 항목을 입력하고, 참가 스트리머가 중복 없이 선택됐는지 확인해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    typeSelect.disabled = true;
    titleInput.disabled = true;
    betHoursInput.disabled = true;
    eventHoursInput.disabled = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '제안 처리중...';

    window.sbmFirebase.httpsCallable('submitMarketProposal')({
      title: titleInput.value.trim(),
      type: typeSelect.value,
      streamerIds: streamers,
      betHours: betHours,
      eventHours: eventHours,
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
      submitBtn.disabled = false;
      submitBtn.textContent = '제안하기';
      errorEl.textContent = err.message || '제안 처리 중 오류가 발생했습니다.';
      errorEl.classList.add('show');
    });
  });
})();
