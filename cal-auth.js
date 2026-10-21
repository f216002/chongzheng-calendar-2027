/* ---- 寶光崇正行事曆 Google 登入（比照 V4 語橋學苑 v4-auth.js 最新解法） ----
   全平台使用彈出視窗登入（signInWithPopup）。整頁跳轉登入（signInWithRedirect）
   在 iPhone Safari 實測會遺失登入結果（跨站儲存被擋），絕不使用；
   getRedirectResult 只保留收尾，處理殘留的跳轉結果。
   LINE / Facebook 等 App 內建瀏覽器無法做 Google 登入（Google 自 2021 年封鎖
   內嵌 webview 登入），偵測到時改為一鍵跳轉系統瀏覽器＋引導面板。
   登入狀態發布到 window.CAL_AUTH，並觸發 cal-auth-changed 事件；
   畫面（閘門/帳號列）由 app.js 依 cal-access 的審核狀態統一管理。 */
(function () {
  'use strict';

  window.CAL_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyChpInXumwIWaOrR4cU8KhNm1NK5-RdgQw',
    authDomain: 'my-chinese-sentence-bank-v3.firebaseapp.com',
    projectId: 'my-chinese-sentence-bank-v3',
    storageBucket: 'my-chinese-sentence-bank-v3.firebasestorage.app',
    messagingSenderId: '178850974896',
    appId: '1:178850974896:web:f1d40b2ed4e7218b553f75'
  };
  /* 管理員（與 V4 相同）。審核只認這個 Google 帳號。 */
  window.CAL_ADMIN_EMAIL = 'f216002@gmail.com';

  function $(id) { return document.getElementById(id); }

  var auth = null;
  try {
    if (!window.firebase) throw new Error('Firebase SDK 載入失敗。');
    if (!window.firebase.apps.length) {
      window.firebase.initializeApp(window.CAL_FIREBASE_CONFIG);
    }
    auth = window.firebase.auth();
  } catch (err) {
    var msg = $('calAuthMessage');
    if (msg) msg.textContent = '登入功能暫時無法使用，請重新整理頁面。';
    window.CAL_AUTH = Object.freeze({ ready: false, user: null });
    return;
  }
  window.CAL_AUTH_INSTANCE = auth;

  var provider = new window.firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  var signInButton = $('calGoogleSignIn');
  var authMessage = $('calAuthMessage');

  /* 登入中極簡模式：過渡期間卡片只顯示「登入中…請稍待」與重新整理鍵，
     避免使用者誤以為要再按一次登入（Cheng 2026-10-21 指示）。 */
  var gateCard = document.querySelector('.auth-gate-card');
  var signingInBox = $('calSigningIn');
  function setSigningInMode(on) {
    if (gateCard) gateCard.classList.toggle('is-signing-in', !!on);
    if (signingInBox) signingInBox.hidden = !on;
  }
  window.calSetSigningInMode = setSigningInMode;

  function setAuthMessage(message, isError) {
    if (!authMessage) return;
    authMessage.textContent = message || '';
    authMessage.classList.toggle('error', !!isError);
  }
  window.calSetAuthMessage = setAuthMessage;

  /* ---- 內建瀏覽器偵測（比照 V4 2026-10-05） ---- */
  function detectInAppBrowser() {
    var ua = navigator.userAgent || '';
    if (/Line\//i.test(ua)) return 'LINE';
    if (/FBAN\/|FBAV\//i.test(ua)) return 'Facebook';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/MicroMessenger/i.test(ua)) return 'WeChat';
    return null;
  }

  /* ---- 一鍵跳轉系統瀏覽器（比照 V4） ---- */
  function openInSystemBrowser() {
    var appName = detectInAppBrowser();
    var url = location.origin + location.pathname;
    var ua = navigator.userAgent || '';
    var target = null;
    if (/iPad|iPhone|iPod/.test(ua)) {
      target = 'x-safari-' + url;
    } else if (/Android/.test(ua)) {
      target = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;end';
    }
    if (target) {
      location.href = target;
      showWebviewGuide(appName, true);
    } else {
      showWebviewGuide(appName, false);
    }
  }

  function showWebviewGuide(appName, escapeAttempted) {
    var old = $('calWebviewGuide');
    if (old) old.remove();
    var siteUrl = location.origin + location.pathname;
    var overlay = document.createElement('div');
    overlay.id = 'calWebviewGuide';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);' +
      'display:flex;align-items:center;justify-content:center;padding:24px;';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fffdf8;border-radius:16px;max-width:420px;width:100%;' +
      'padding:24px;color:#2b2620;font-size:.95rem;line-height:1.7;';
    card.innerHTML =
      '<h3 style="margin:0 0 10px;font-size:1.1rem;">' +
      (escapeAttempted ? '沒有自動跳轉嗎？請手動開啟' : '請用 Safari / Chrome 開啟再登入') + '</h3>' +
      '<p style="margin:0 0 10px;">您正在「' + appName + '」的內建瀏覽器中，Google 登入在這裡無法使用，這是 App 本身的限制，不是網站故障。</p>' +
      '<p style="margin:0 0 6px;font-weight:700;">' +
      (escapeAttempted ? '剛才已嘗試自動開啟系統瀏覽器，若沒有反應，請這樣做：' : '請這樣做：') + '</p>' +
      '<ol style="margin:0 0 12px;padding-left:22px;">' +
      '<li>先複製本站網址（按下面按鈕）</li>' +
      '<li>iPhone 打開 Safari，Android 手機打開 Chrome</li>' +
      '<li>在網址列貼上網址，開啟網站後再登入</li>' +
      '</ol>' +
      '<p style="margin:0 0 12px;word-break:break-all;font-size:.82rem;color:#8a7f6a;">' + siteUrl + '</p>';
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = '複製網站網址';
    copyBtn.style.cssText = 'font:inherit;cursor:pointer;border-radius:10px;border:1px solid #d8cdb4;' +
      'background:#fff;color:#2b2620;padding:10px 20px;width:100%;margin-bottom:8px;';
    var copyMsg = document.createElement('div');
    copyMsg.style.cssText = 'font-size:.85rem;color:#2e7d32;min-height:1.4em;margin-bottom:8px;text-align:center;';
    copyBtn.addEventListener('click', function () {
      function done(ok) {
        copyMsg.textContent = ok ? '已複製！去 Safari／Chrome 貼上開啟吧。' : '複製失敗，請長按上方網址手動複製。';
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(siteUrl).then(function () { done(true); }, function () { done(false); });
      } else {
        var ta = document.createElement('textarea');
        ta.value = siteUrl;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { done(document.execCommand('copy')); } catch (e) { done(false); }
        ta.remove();
      }
    });
    card.appendChild(copyBtn);
    card.appendChild(copyMsg);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '我知道了';
    btn.style.cssText = 'font:inherit;cursor:pointer;border-radius:10px;border:1px solid #d8cdb4;' +
      'background:#2b2620;color:#fff;padding:10px 20px;width:100%;';
    btn.addEventListener('click', function () { overlay.remove(); });
    card.appendChild(btn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  function publishAuthState(user) {
    window.CAL_AUTH = Object.freeze({
      ready: true,
      user: user ? Object.freeze({
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || ''
      }) : null
    });
    window.dispatchEvent(new CustomEvent('cal-auth-changed', { detail: window.CAL_AUTH }));
  }

  if (signInButton) {
    if (detectInAppBrowser()) {
      signInButton.textContent = '在瀏覽器中開啟並登入';
    }
    signInButton.addEventListener('click', function () {
      if (detectInAppBrowser()) { openInSystemBrowser(); return; }
      signInButton.disabled = true;
      /* 一律彈出視窗登入（V4 2026-10-17 修正版）：整頁跳轉在 iPhone Safari
         會遺失登入結果；popup 路徑在管理員手機長期實測正常。 */
      setAuthMessage('');
      setSigningInMode(true);
      /* 看門狗：iPhone 主畫面 App 等環境下，登入彈窗可能永遠不回傳，
         30 秒後自動恢復按鈕並提示改走重新整理或 Safari，避免頁面假死。 */
      var popupSettled = false;
      var popupWatchdog = setTimeout(function () {
        if (popupSettled || auth.currentUser) return;
        signInButton.disabled = false;
        setSigningInMode(false);
        setAuthMessage('登入視窗尚未完成或卡住了。請再按一次登入，或點下方「重新整理頁面」後再試；若反覆發生，請改用 Safari 直接開啟本網址登入。', true);
      }, 30000);
      auth.signInWithPopup(provider).catch(function (error) {
        var code = (error && error.code) || '';
        if (code === 'auth/popup-blocked') {
          setAuthMessage('彈出視窗被阻擋，請允許本網站的彈出視窗後再試一次。', true);
        } else if (code === 'auth/popup-closed-by-user') {
          setAuthMessage('已關閉 Google 登入視窗。');
        } else if (code === 'auth/cancelled-popup-request') {
          setAuthMessage('登入被中斷，請再按一次登入。');
        } else if (code === 'auth/unauthorized-domain') {
          setAuthMessage('此網域尚未在 Firebase 授權，請聯繫管理員。', true);
        } else if (code === 'auth/operation-not-supported-in-this-environment') {
          setAuthMessage('請用 Safari 或 Chrome 直接開啟本網站再登入。', true);
        } else {
          setAuthMessage('Google 登入失敗：' + ((error && error.message) || code), true);
        }
      }).finally(function () {
        popupSettled = true;
        clearTimeout(popupWatchdog);
        if (!auth.currentUser) {
          signInButton.disabled = false;
          setSigningInMode(false);
        }
      });
    });
  }

  /* 登出按鈕（閘門與帳號列各一顆，用 data-cal-sign-out 標記）。 */
  document.querySelectorAll('[data-cal-sign-out]').forEach(function (button) {
    button.addEventListener('click', function () {
      button.disabled = true;
      auth.signOut().catch(function (error) {
        setAuthMessage('登出失敗：' + ((error && error.message) || error.code), true);
      }).finally(function () { button.disabled = false; });
    });
  });

  /* 整頁跳轉登入的回程收尾（殘留結果處理）：成功時 onAuthStateChanged 會接手；
     失敗時把 Firebase 的實際錯誤顯示出來，不靜默。 */
  if (auth.getRedirectResult) {
    auth.getRedirectResult().then(function () {}).catch(function (error) {
      setAuthMessage('Google 登入失敗：' + ((error && error.message) || (error && error.code) || ''), true);
    });
  }

  window.CAL_AUTH = Object.freeze({ ready: false, user: null });
  auth.onAuthStateChanged(function (user) {
    if (user && user.isAnonymous) {
      auth.signOut();
      return;
    }
    publishAuthState(user);
  });
})();
