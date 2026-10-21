/* ---- 寶光崇正行事曆 審核管理（僅管理員 f216002@gmail.com 可用） ----
   待審申請（cal_accessRequests, status=pending）：核准 / 拒絕。
   已核准使用者（cal_approvedUsers）：停用 / 重新啟用 / 移除。
   核准＝在 cal_approvedUsers 建立 active:true 文件，並把申請標為 approved。 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var modal = null;
  var pendingList = null;
  var approvedList = null;
  var statusLine = null;

  function db() { return window.CAL_DB; }
  function ts() { return window.firebase.firestore.FieldValue.serverTimestamp(); }

  function rowEl(item, actions) {
    var row = document.createElement('div');
    row.className = 'admin-row';
    var info = document.createElement('div');
    info.className = 'admin-row-info';
    var name = document.createElement('strong');
    name.textContent = item.displayName || '（未提供姓名）';
    var email = document.createElement('span');
    email.textContent = item.email || '';
    info.append(name, email);
    var btns = document.createElement('div');
    btns.className = 'admin-row-actions';
    actions.forEach(function (action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.className) button.className = action.className;
      button.addEventListener('click', function () { action.onClick(button); });
      btns.append(button);
    });
    row.append(info, btns);
    return row;
  }

  function emptyEl(text) {
    var p = document.createElement('p');
    p.className = 'admin-empty';
    p.textContent = text;
    return p;
  }

  async function loadAdminLists() {
    if (!db()) return;
    statusLine.textContent = '載入中…';
    try {
      var reqSnap = await db().collection('cal_accessRequests')
        .where('status', '==', 'pending').get();
      var requests = reqSnap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); });
      requests.sort(function (a, b) {
        return String(a.requestedAt?.toMillis?.() || 0) - String(b.requestedAt?.toMillis?.() || 0);
      });
      pendingList.replaceChildren(...(requests.length
        ? requests.map(function (item) {
            return rowEl(item, [
              { label: '核准', className: 'admin-approve', onClick: function (btn) { approve(item, btn); } },
              { label: '拒絕', className: 'admin-reject', onClick: function (btn) { reject(item, btn); } }
            ]);
          })
        : [emptyEl('目前沒有待審核的申請。')]));

      var appSnap = await db().collection('cal_approvedUsers').get();
      var approved = appSnap.docs.map(function (d) { return Object.assign({ uid: d.id }, d.data()); });
      approved.sort(function (a, b) { return String(a.email || '').localeCompare(String(b.email || '')); });
      approvedList.replaceChildren(...(approved.length
        ? approved.map(function (item) {
            var active = item.active === true;
            return rowEl(Object.assign({}, item, {
              displayName: (item.displayName || '（未提供姓名）') + (active ? '' : '（已停用）')
            }), [
              active
                ? { label: '停用', onClick: function (btn) { setActive(item, false, btn); } }
                : { label: '重新啟用', className: 'admin-approve', onClick: function (btn) { setActive(item, true, btn); } },
              { label: '移除', className: 'admin-reject', onClick: function (btn) { removeApproved(item, btn); } }
            ]);
          })
        : [emptyEl('目前沒有已核准的使用者。')]));
      statusLine.textContent = `待審核 ${requests.length} 人 · 已核准 ${approved.length} 人`;
    } catch (error) {
      console.error('載入審核名單失敗：', error);
      statusLine.textContent = '載入失敗，請確認 Firestore 規則已更新後再試。';
    }
  }

  async function approve(item, btn) {
    btn.disabled = true;
    try {
      await db().collection('cal_approvedUsers').doc(item.uid).set({
        uid: item.uid,
        email: item.email || '',
        displayName: item.displayName || '',
        photoURL: item.photoURL || '',
        active: true,
        status: 'approved',
        approvedAt: ts(),
        updatedAt: ts()
      }, { merge: true });
      await db().collection('cal_accessRequests').doc(item.uid)
        .set({ status: 'approved', updatedAt: ts() }, { merge: true });
      loadAdminLists();
    } catch (error) {
      console.error('核准失敗：', error);
      btn.disabled = false;
      window.alert('核准失敗，請稍後再試。');
    }
  }

  async function reject(item, btn) {
    if (!window.confirm(`確定要拒絕 ${item.email || item.displayName} 的申請嗎？`)) return;
    btn.disabled = true;
    try {
      await db().collection('cal_accessRequests').doc(item.uid)
        .set({ status: 'rejected', updatedAt: ts() }, { merge: true });
      loadAdminLists();
    } catch (error) {
      console.error('拒絕失敗：', error);
      btn.disabled = false;
      window.alert('操作失敗，請稍後再試。');
    }
  }

  async function setActive(item, active, btn) {
    btn.disabled = true;
    try {
      await db().collection('cal_approvedUsers').doc(item.uid)
        .set({ active: active, status: active ? 'approved' : 'suspended', updatedAt: ts() }, { merge: true });
      loadAdminLists();
    } catch (error) {
      console.error('變更狀態失敗：', error);
      btn.disabled = false;
      window.alert('操作失敗，請稍後再試。');
    }
  }

  async function removeApproved(item, btn) {
    if (!window.confirm(`確定要移除 ${item.email || item.displayName} 的使用資格嗎？（對方下次登入會重新送出申請）`)) return;
    btn.disabled = true;
    try {
      await db().collection('cal_approvedUsers').doc(item.uid).delete();
      loadAdminLists();
    } catch (error) {
      console.error('移除失敗：', error);
      btn.disabled = false;
      window.alert('操作失敗，請稍後再試。');
    }
  }

  window.calOpenAdmin = function () {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    loadAdminLists();
  };
  window.calCloseAdmin = function () {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  };

  document.addEventListener('DOMContentLoaded', function () {
    modal = $('adminModal');
    pendingList = $('adminPendingList');
    approvedList = $('adminApprovedList');
    statusLine = $('adminStatus');
    $('adminClose')?.addEventListener('click', window.calCloseAdmin);
    document.querySelectorAll('[data-admin-close]').forEach(function (button) {
      button.addEventListener('click', window.calCloseAdmin);
    });
  });
})();
