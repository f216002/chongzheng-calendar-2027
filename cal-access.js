/* ---- 寶光崇正行事曆 使用者審核狀態（比照 V4 v4-access.js，集合獨立） ----
   使用 cal_accessRequests（申請）與 cal_approvedUsers（核准名單），
   與 V4 的 v4_accessRequests / v4_approvedTeachers 完全隔離。
   狀態發布到 window.CAL_ACCESS，並觸發 cal-access-changed 事件。
   狀態：checking / signed-out / needs-application / pending / approved / rejected / suspended / error */
(function () {
  'use strict';

  var db = null;
  var auth = null;
  try {
    if (!window.firebase || !window.firebase.apps.length) throw new Error('Firebase 尚未初始化。');
    db = window.firebase.firestore();
    auth = window.firebase.auth();
  } catch (err) {
    window.CAL_ACCESS = Object.freeze({ ready: false, status: 'error', user: null, isAdmin: false });
    return;
  }
  window.CAL_DB = db;


  /* Firestore 讀寫逾時保護：網路卡住時不讓閘門永遠停在「正在確認登入狀態」。 */
  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise(function (resolve, reject) {
      setTimeout(function () { reject(new Error('確認逾時')); }, ms);
    })]);
  }

  function requestDoc(uid) { return db.collection('cal_accessRequests').doc(uid); }

  function isAdminUser(user) {
    return !!user && String(user.email || '').toLowerCase() === String(window.CAL_ADMIN_EMAIL || '').toLowerCase();
  }

  function publishAccess(user, status, isAdmin) {
    window.CAL_ACCESS = Object.freeze({
      ready: status !== 'checking',
      status: status,
      user: user ? Object.freeze({
        uid: user.uid,
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || ''
      }) : null,
      isAdmin: !!isAdmin
    });
    window.dispatchEvent(new CustomEvent('cal-access-changed', { detail: window.CAL_ACCESS }));
  }

  /* app.js 的寫入入口：一律先過這一關，未核准就擋下並丟出中文訊息。 */
  window.calRequireApproved = function () {
    var a = window.CAL_ACCESS;
    if (!a || !a.ready) throw new Error('登入狀態確認中，請稍候再試。');
    if (a.status !== 'approved') {
      if (a.status === 'signed-out') throw new Error('請先用 Google 登入。');
      if (a.status === 'pending') throw new Error('申請審核中，管理員核准後即可使用。');
      if (a.status === 'rejected') throw new Error('申請未通過，請聯繫管理員。');
      if (a.status === 'suspended') throw new Error('帳號目前暫停使用，請聯繫管理員。');
      throw new Error('身分確認失敗，請重新整理頁面再試。');
    }
    var user = auth.currentUser;
    if (!user) throw new Error('請先用 Google 登入。');
    return user;
  };

  async function resolveAccess(user) {
    /* 未登入或殘留的匿名 session：一律視為未登入。 */
    if (!user || user.isAnonymous) { publishAccess(null, 'signed-out', false); return; }
    publishAccess(user, 'checking', false);

    /* 管理員本人：不經審核，直接通過。 */
    if (isAdminUser(user)) { publishAccess(user, 'approved', true); return; }

    var approvalSnap = await withTimeout(db.collection('cal_approvedUsers').doc(user.uid).get(), 15000);
    if (approvalSnap.exists) {
      var data = approvalSnap.data() || {};
      if (data.active === true) { publishAccess(user, 'approved', false); return; }
      publishAccess(user, data.status || 'suspended', false);
      return;
    }

    /* 預先核准（2026-10-27 新增）：管理員依 Email 預先加入的核心成員，
       首次登入即直接通過，不必送審核；讀不到或非本人資料時視為無預核准，
       繼續走一般申請流程（讀取被拒是預期內的，靜默處理）。 */
    try {
      var preSnap = await withTimeout(db.collection('cal_emailPreapprovals')
        .doc(String(user.email || '').toLowerCase()).get(), 15000);
      if (preSnap.exists) {
        var pre = preSnap.data() || {};
        if (pre.active === true &&
            String(pre.email || '').toLowerCase() === String(user.email || '').toLowerCase()) {
          publishAccess(user, 'approved', false);
          return;
        }
      }
    } catch (preError) { /* 無預核准，繼續走一般申請流程 */ }

    /* 沒有核准記錄：查看申請；尚未申請者顯示申請表單（2026-10-27 新增：
       姓名／單位／區別三格必填，比照三寶讀書會），不自動建立空白申請。 */
    var reqRef = requestDoc(user.uid);
    var reqSnap = await withTimeout(reqRef.get(), 15000);
    if (reqSnap.exists) {
      publishAccess(user, (reqSnap.data() || {}).status || 'pending', false);
    } else {
      publishAccess(user, 'needs-application', false);
    }
  }

  /* 申請表單送出（比照三寶讀書會 sanbao-gate.js）：三格皆必填，寫入申請單供後台審核。 */
  function submitApplication() {
    var user = auth.currentUser;
    if (!user) return;
    var nameEl = document.getElementById('calApplyName');
    var unitEl = document.getElementById('calApplyUnit');
    var districtEl = document.getElementById('calApplyDistrict');
    var submitBtn = document.getElementById('calApplySubmit');
    var name = nameEl ? nameEl.value.trim() : '';
    var unit = unitEl ? unitEl.value.trim() : '';
    var district = districtEl ? districtEl.value.trim() : '';
    if (!name || !unit || !district) {
      if (window.calSetAuthMessage) window.calSetAuthMessage('請填寫姓名、單位、區別，三格都是必填。', true);
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    withTimeout(requestDoc(user.uid).set({
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      name: name,
      unit: unit,
      district: district,
      photoURL: user.photoURL || '',
      status: 'pending',
      requestedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
    }), 15000).then(function () {
      return resolveAccess(user);
    }).catch(function (error) {
      console.error('送出申請失敗：', error);
      if (window.calSetAuthMessage) window.calSetAuthMessage('送出申請失敗，請稍後再試。', true);
      if (submitBtn) submitBtn.disabled = false;
    });
  }
  var applyForm = document.getElementById('calApplyForm');
  if (applyForm) {
    applyForm.addEventListener('submit', function (event) {
      event.preventDefault();
      submitApplication();
    });
  }

  window.CAL_ACCESS = Object.freeze({ ready: false, status: 'checking', user: null, isAdmin: false });

  auth.onAuthStateChanged(function (user) {
    resolveAccess(user).catch(function (error) {
      console.error('行事曆 access check failed:', error);
      publishAccess(user, 'error', isAdminUser(user));
    });
  });
})();
