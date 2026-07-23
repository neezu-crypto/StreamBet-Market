// 게임 처음 접하는 유저용 안내 모달 — boot 로딩이 끝난 직후 1회 노출.
// "다시 보지 않기"는 계정이 아니라 이 브라우저 기준(localStorage)으로 기억한다.
(function () {
  var STORAGE_KEY = 'sbm_hide_intro';
  var backdrop = document.getElementById('intro-backdrop');
  var closeBtn = document.getElementById('intro-modal-close');
  var confirmBtn = document.getElementById('intro-close-btn');
  var dontShowCheckbox = document.getElementById('intro-dont-show');
  if (!backdrop) return;

  function closeModal() {
    if (dontShowCheckbox.checked) {
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch (e) {}
    }
    backdrop.classList.remove('open');
  }

  closeBtn.addEventListener('click', closeModal);
  confirmBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  document.addEventListener('sbm-boot-done', function () {
    var hidden = false;
    try { hidden = localStorage.getItem(STORAGE_KEY) === '1'; } catch (e) {}
    if (!hidden) backdrop.classList.add('open');
  });
})();
