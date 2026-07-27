// 16번 — 출석 체크 보상 선택 모달(관리자 시범). 기존 출석 체크(js/wallet.js,
// claimAttendance)는 그대로 두고, 관리자에 한해 클릭 시 이 모달을 띄워
// "오늘 그대로 받기" / "광고보고 2배 받기" 중 고르게 한다. 광고는 Google IMA
// SDK로 재생하고, 구글이 공개한 보상형(rewarded) 테스트 태그를 쓰기 때문에
// Google Ad Manager 계정 승인 없이 지금 바로 동작을 확인할 수 있다(실제 태그가
// 생기면 SAMPLE_REWARDED_AD_TAG만 바꿔치기하면 됨). 실제 브라우저 재생 여부는
// 이 환경에서 직접 확인할 수 없으므로 배포 후 육안 확인이 필요하다.
(function () {
  var backdrop = document.getElementById('checkin-backdrop');
  var closeBtn = document.getElementById('checkin-modal-close');
  var plainBtn = document.getElementById('checkin-claim-plain-btn');
  var adBtn = document.getElementById('checkin-claim-ad-btn');
  var plainLabel = document.getElementById('checkin-plain-label');
  var adLabel = document.getElementById('checkin-ad-label');
  var adStage = document.getElementById('checkin-ad-stage');
  var adContainer = document.getElementById('checkin-ad-container');
  var adVideo = document.getElementById('checkin-ad-video');
  var statusEl = document.getElementById('checkin-modal-status');
  if (!backdrop || !plainBtn || !adBtn) return;

  var SAMPLE_REWARDED_AD_TAG =
    'https://pubads.g.doubleclick.net/gampad/ads?iu=/21775744923/external/single_ad_samples' +
    '&sz=640x480&cust_params=sample_ct%3Drewardedvideo&ciu_szs=300x250&gdfp_req=1&output=vast' +
    '&unviewed_position_start=1&env=vp&impl=s&correlator=';

  var imaLoadPromise = null;
  function loadImaSdk() {
    if (window.google && window.google.ima) return Promise.resolve();
    if (imaLoadPromise) return imaLoadPromise;
    imaLoadPromise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://imasdk.googleapis.com/js/sdkloader/ima3.js';
      script.onload = function () { resolve(); };
      script.onerror = function () { imaLoadPromise = null; reject(new Error('광고 SDK를 불러오지 못했습니다.')); };
      document.head.appendChild(script);
    });
    return imaLoadPromise;
  }

  var adsLoader = null;
  var adsManager = null;
  var adDisplayContainer = null;

  function cleanupAd() {
    adRequestSettled = true;
    clearAdTimeout();
    if (adsManager) { try { adsManager.destroy(); } catch (e) { /* noop */ } adsManager = null; }
    if (adsLoader) { try { adsLoader.destroy(); } catch (e) { /* noop */ } adsLoader = null; }
    adDisplayContainer = null;
    if (adStage) adStage.style.display = 'none';
    if (adVideo && adVideo.pause) adVideo.pause();
  }

  function setStatus(text) { if (statusEl) statusEl.textContent = text || ''; }

  function refreshLabels() {
    var base = window.sbmGetTodayAttendanceAmount ? window.sbmGetTodayAttendanceAmount(window.sbmLastWallet) : 10000;
    plainLabel.textContent = '오늘 ' + base.toLocaleString('ko-KR') + '원 받기';
    adLabel.textContent = '광고보고 ' + (base * 2).toLocaleString('ko-KR') + '원 받기';
  }

  function openModal() {
    refreshLabels();
    setStatus('');
    plainBtn.disabled = false;
    adBtn.disabled = false;
    cleanupAd();
    backdrop.classList.add('open');
    loadImaSdk().catch(function () { /* 클릭 시점에 다시 시도 — 지금은 조용히 무시 */ });
  }
  window.sbmOpenCheckinModal = openModal;

  function closeModal() {
    backdrop.classList.remove('open');
    cleanupAd();
  }

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) closeModal();
  });

  function claim(watchedAd) {
    plainBtn.disabled = true;
    adBtn.disabled = true;
    window.sbmFirebase.httpsCallable('claimAttendance')({ watchedAd: !!watchedAd })
      .then(function () {
        setStatus('출석 보상을 받았습니다!');
        setTimeout(closeModal, 900);
      })
      .catch(function (e) {
        setStatus(e.message);
        plainBtn.disabled = false;
        adBtn.disabled = false;
      });
  }

  plainBtn.addEventListener('click', function () { claim(false); });

  // IMA SDK가 네트워크 자체 실패(DNS 차단 등) 상황에서 AD_ERROR 이벤트를 우리
  // 리스너까지 깔끔하게 전달하지 못하는 경우가 있어(내부 프라미스 reject로만
  // 끝나는 케이스 관찰됨), 일정 시간 안에 광고가 뜨지도 실패 이벤트가 오지도
  // 않으면 강제로 에러 처리하는 타임아웃 안전장치를 둔다.
  var adRequestSettled = true;
  var adTimeoutId = null;
  function clearAdTimeout() {
    if (adTimeoutId) { clearTimeout(adTimeoutId); adTimeoutId = null; }
  }

  function onAdError() {
    if (adRequestSettled) return;
    adRequestSettled = true;
    clearAdTimeout();
    setStatus('광고를 불러오지 못했습니다. 광고 차단기·DNS 설정을 확인하거나 잠시 후 다시 시도해주세요.');
    cleanupAd();
    plainBtn.disabled = false;
    adBtn.disabled = false;
  }

  function onAdRewardEarned() {
    if (adRequestSettled) return;
    adRequestSettled = true;
    clearAdTimeout();
    cleanupAd();
    claim(true);
  }

  adBtn.addEventListener('click', function () {
    adBtn.disabled = true;
    plainBtn.disabled = true;
    if (adStage) adStage.style.display = '';
    setStatus('광고를 불러오는 중...');
    adRequestSettled = false;
    clearAdTimeout();
    adTimeoutId = setTimeout(onAdError, 8000);

    // adDisplayContainer.initialize()는 브라우저 자동재생 정책 때문에 반드시
    // "사용자 클릭 핸들러 안에서 동기적으로" 호출해야 한다 — SDK가 이미
    // 로드돼 있으면(모달 열릴 때 미리 로드 시도함) 여기서 바로 동기 실행되고,
    // 아직이면 부득이하게 비동기 로드 후 호출한다(그 경우 일부 브라우저에서
    // 자동재생이 막힐 수 있음).
    function proceed() {
      try {
        adDisplayContainer = new google.ima.AdDisplayContainer(adContainer, adVideo);
        adDisplayContainer.initialize();

        adsLoader = new google.ima.AdsLoader(adDisplayContainer);
        adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, onAdError, false);
        adsLoader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, function (event) {
          adsManager = event.getAdsManager(adVideo);
          adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, onAdError);
          // 보상형 광고 시청 완료 시점 — REWARD 이벤트를 우선 쓰고, 이 데모 태그가
          // REWARD를 안 쏘는 경우를 대비해 ALL_ADS_COMPLETED에서도 한 번 더 잡는다
          // (adRequestSettled 플래그로 중복 지급은 막는다).
          adsManager.addEventListener(google.ima.AdEvent.Type.REWARD, onAdRewardEarned);
          adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, onAdRewardEarned);
          try {
            adsManager.init(640, 360, google.ima.ViewMode.NORMAL);
            adsManager.start();
          } catch (adErr) {
            onAdError(adErr);
          }
        }, false);

        var adsRequest = new google.ima.AdsRequest();
        adsRequest.adTagUrl = SAMPLE_REWARDED_AD_TAG + Date.now();
        adsRequest.linearAdSlotWidth = 640;
        adsRequest.linearAdSlotHeight = 360;
        adsRequest.nonLinearAdSlotWidth = 640;
        adsRequest.nonLinearAdSlotHeight = 150;
        adsLoader.requestAds(adsRequest);
      } catch (e) {
        onAdError(e);
      }
    }

    if (window.google && window.google.ima) {
      proceed();
    } else {
      loadImaSdk().then(proceed).catch(onAdError);
    }
  });
})();
