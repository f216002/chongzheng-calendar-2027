/* ---- 寶光崇正行事曆 使用者審核狀態（比照 V4 v4-access.js，集合獨立） ----
   使用 cal_accessRequests（申請）與 cal_approvedUsers（核准名單），
   與 V4 的 v4_accessRequests / v4_approvedTeachers 完全隔離。
   狀態發布到 window.CAL_ACCESS，並觸發 cal-access-changed 事件。
   狀態：checking / signed-out / pending / approved / rejected / suspended / error */
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

    var approvalSnap = await db.collection('cal_approvedUsers').doc(user.uid).get();
    if (approvalSnap.exists) {
      var data = approvalSnap.data() || {};
      if (data.active === true) { publishAccess(user, 'approved', false); return; }
      publishAccess(user, data.status || 'suspended', false);
      return;
    }

    /* 沒有核准記錄：查看或建立申請。 */
    var reqRef = requestDoc(user.uid);
    var reqSnap = await reqRef.get();
    var status = 'pending';
    if (reqSnap.exists) {
      status = (reqSnap.data() || {}).status || 'pending';
    } else {
      await reqRef.set({
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        status: 'pending',
        requestedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    publishAccess(user, status, false);
  }

  window.CAL_ACCESS = Object.freeze({ ready: false, status: 'checking', user: null, isAdmin: false });

  auth.onAuthStateChanged(function (user) {
    resolveAccess(user).catch(function (error) {
      console.error('行事曆 access check failed:', error);
      publishAccess(user, 'error', isAdminUser(user));
    });
  });
})();
