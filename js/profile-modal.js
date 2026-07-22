(function () {
  var openBtn = document.getElementById('open-profile-modal');
  var backdrop = document.getElementById('profile-backdrop');
  var closeBtn = document.getElementById('profile-modal-close');
  var nicknameInput = document.getElementById('profile-nickname');
  var soopIdInput = document.getElementById('profile-soopid');
  var previewImg = document.getElementById('profile-preview-img');
  var previewPlaceholder = document.getElementById('profile-preview-placeholder');
  var errorEl = document.getElementById('profile-error');
  var saveBtn = document.getElementById('profile-save-btn');
  var statusEl = document.getElementById('profile-status');
  if (!backdrop || !openBtn) return;

  var currentProfile = null;

  function computeAvatarSrc(soopId) {
    var folder = soopId.slice(0, 2);
    return 'https://stimg.sooplive.com/LOGO/' + folder + '/' + soopId + '/' + soopId + '.jpg';
  }

  function applyProfile(name, avatarSrc) {
    openBtn.classList.remove('avatar-login');
    if (avatarSrc) {
      openBtn.innerHTML = '<img src="' + sbmEscapeHtml(avatarSrc) + '" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
    } else {
      openBtn.textContent = name ? name.charAt(0) : '?';
    }
    document.querySelectorAll('.ranking-avatar[data-id="me"]').forEach(function (el) {
      var img = el.querySelector('.ravatar-img');
      var initialEl = el.querySelector('.ravatar-initial');
      if (avatarSrc) {
        img.src = avatarSrc;
        img.style.display = 'block';
        initialEl.style.display = 'none';
      } else {
        img.style.display = 'none';
        initialEl.style.display = '';
        initialEl.textContent = name ? name.charAt(0) : '?';
      }
    });
    document.querySelectorAll('.ranking-row.me .ranking-name').forEach(function (el) {
      el.childNodes[0].textContent = name || '';
    });
  }

  document.addEventListener('sbm-auth-changed', function (e) {
    var user = e.detail.realUser;
    if (!user) {
      currentProfile = null;
      openBtn.textContent = '로그인';
      openBtn.classList.add('avatar-login');
      return;
    }
    var fb = window.sbmFirebase;
    fb.onValue(fb.ref(window.sbmDb, 'bettingMarket/profiles/' + user.uid), function (snap) {
      currentProfile = snap.val() || { nickname: user.displayName || '유저', soopId: '', avatarUrl: '' };
      applyProfile(currentProfile.nickname, currentProfile.avatarUrl);
    });
  });

  function openModal() {
    if (!window.sbmRealUser) { window.sbmOpenLoginModal && window.sbmOpenLoginModal(); return; }
    var p = currentProfile || {};
    nicknameInput.value = p.nickname || '';
    soopIdInput.value = p.soopId || '';
    if (p.avatarUrl) {
      previewImg.src = p.avatarUrl;
      previewImg.style.display = 'block';
      previewPlaceholder.style.display = 'none';
    } else {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
    }
    errorEl.classList.remove('show');
    statusEl.classList.remove('show');
    saveBtn.disabled = false;
    saveBtn.textContent = '저장';
    backdrop.classList.add('open');
    nicknameInput.focus();
  }
  function closeModal() { backdrop.classList.remove('open'); }

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  soopIdInput.addEventListener('input', function () {
    var id = soopIdInput.value.trim();
    if (id.length < 2) {
      previewImg.style.display = 'none';
      previewPlaceholder.style.display = '';
      return;
    }
    previewImg.onload = function () { previewImg.style.display = 'block'; previewPlaceholder.style.display = 'none'; };
    previewImg.onerror = function () { previewImg.style.display = 'none'; previewPlaceholder.style.display = ''; };
    previewImg.src = computeAvatarSrc(id);
  });

  saveBtn.addEventListener('click', function () {
    var name = nicknameInput.value.trim();
    if (!name) {
      errorEl.textContent = '닉네임을 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    if (name.length > 12 || /[<>\x00-\x1F\x7F]/.test(name)) {
      errorEl.textContent = '닉네임은 12자 이하, 사용할 수 없는 문자 없이 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    var soopId = soopIdInput.value.trim();
    if (soopId && !/^[a-z0-9]{2,20}$/.test(soopId)) {
      errorEl.textContent = 'SOOP 아이디는 영문 소문자/숫자 2~20자로 입력해 주세요.';
      errorEl.classList.add('show');
      return;
    }
    errorEl.classList.remove('show');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장중...';

    window.sbmFirebase.httpsCallable('updateProfile')({ nickname: name, soopId: soopId })
      .then(function () {
        saveBtn.textContent = '저장 완료';
        statusEl.style.color = 'var(--mint)';
        statusEl.textContent = '프로필이 저장됐습니다.';
        statusEl.classList.add('show');
      })
      .catch(function (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
        errorEl.textContent = err.message || '저장 중 오류가 발생했습니다.';
        errorEl.classList.add('show');
      });
  });
})();
