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
  var approvedByUid = {};
  var overviewData = null;

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
      approvedByUid = {};
      approved.forEach(function (item) { approvedByUid[item.uid] = item; });
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

  /* ---------- 私人行程總覽與匯出 ---------- */
  var RECURRENCE_LABELS = { none: '不重複', weekly: '每週', monthly: '每月', yearly: '每年' };
  var REMINDER_LABELS = { none: '不提醒', '10m': '開始前10分鐘', '30m': '開始前30分鐘', '1h': '開始前1小時', '1d9': '前一天上午9點', '0d9': '當天上午9點' };

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function eventsToCsv(groups) {
    var header = ['使用者姓名', '使用者Email', '內容', '日期', '開始時間', '結束時間', '地點', '週期', '重複至', '提醒', '會議連結', '備註'];
    var lines = [header.map(csvCell).join(',')];
    groups.forEach(function (group) {
      group.events.forEach(function (e) {
        lines.push([
          group.displayName, group.email,
          e.title || '', e.date || '', e.startTime || '', e.endTime || '',
          e.location || '', RECURRENCE_LABELS[e.recurrence || 'none'] || '',
          e.recurrenceUntil || '', REMINDER_LABELS[e.reminder || 'none'] || '',
          e.meetingLink || '', e.notes || ''
        ].map(csvCell).join(','));
      });
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function downloadCsv(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function todayStamp() {
    var now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  }

  async function loadOverview() {
    var status = $('adminOverviewStatus');
    var list = $('adminOverviewList');
    var exportBtn = $('adminExportAll');
    if (!db() || !status || !list) return;
    status.textContent = '載入總覽中…';
    try {
      /* 逐位使用者讀取各自的 privateEvents 子集合（現行規則已允許管理員讀取；
         不用 collectionGroup 查詢，該查詢需額外的遞迴萬用規則）。 */
      var userInfo = new Map();
      var reqSnap = await db().collection('cal_accessRequests').get();
      reqSnap.docs.forEach(function (d) {
        var data = d.data() || {};
        userInfo.set(d.id, { displayName: data.displayName || '', email: data.email || '' });
      });
      var appSnap2 = await db().collection('cal_approvedUsers').get();
      appSnap2.docs.forEach(function (d) {
        var data = d.data() || {};
        userInfo.set(d.id, { displayName: data.displayName || '', email: data.email || '' });
      });
      var me0 = (window.CAL_ACCESS && window.CAL_ACCESS.user) || {};
      if (me0.uid && !userInfo.has(me0.uid)) {
        userInfo.set(me0.uid, { displayName: me0.displayName || '', email: me0.email || '' });
      }
      var perUser = await Promise.all([...userInfo.keys()].map(async function (uid) {
        try {
          var snap = await db().collection('cal_users').doc(uid)
            .collection('privateEvents').get();
          return { uid: uid, docs: snap.docs };
        } catch (error) {
          console.warn('略過無法讀取的私人行程：', uid, error);
          return { uid: uid, docs: [] };
        }
      }));
      var byUid = new Map();
      perUser.forEach(function ({ uid, docs }) {
        if (docs.length) {
          byUid.set(uid, docs.map(function (doc) {
            return Object.assign({ id: doc.id }, doc.data());
          }));
        }
      });
      var me = (window.CAL_ACCESS && window.CAL_ACCESS.user) || {};
      overviewData = [...byUid.entries()].map(function ([uid, events]) {
        var known = approvedByUid[uid] || userInfo.get(uid);
        var displayName = uid === me.uid ? '管理員（本人）'
          : (known && known.displayName ? known.displayName : '（未提供姓名）');
        var email = known && known.email ? known.email
          : (uid === me.uid ? (me.email || '') : uid);
        events.sort(function (a, b) {
          return String(a.date || '').localeCompare(String(b.date || '')) ||
            String(a.startTime || '').localeCompare(String(b.startTime || ''));
        });
        return { uid: uid, displayName: displayName, email: email, events: events };
      }).sort(function (a, b) { return String(a.email).localeCompare(String(b.email)); });

      list.replaceChildren(...(overviewData.length ? overviewData.map(function (group) {
        var block = document.createElement('div');
        block.className = 'admin-overview-user';
        var h = document.createElement('h4');
        h.textContent = `${group.displayName} <${group.email}>（${group.events.length} 筆）`;
        var exp = document.createElement('button');
        exp.type = 'button';
        exp.className = 'account-button';
        exp.textContent = '匯出此人';
        exp.addEventListener('click', function () {
          downloadCsv(`private-events-${todayStamp()}.csv`, eventsToCsv([group]));
        });
        h.append(exp);
        var rows = document.createElement('div');
        rows.className = 'admin-overview-events';
        group.events.forEach(function (e) {
          var row = document.createElement('div');
          row.className = 'admin-overview-event';
          var parts = [String(e.date || '').replaceAll('-', '/'),
            [e.startTime, e.endTime].filter(Boolean).join('-'),
            e.location || '',
            e.recurrence && e.recurrence !== 'none' ? `🔁 ${RECURRENCE_LABELS[e.recurrence]}` : ''
          ].filter(Boolean).join(' · ');
          row.innerHTML = '';
          var strong = document.createElement('strong');
          strong.textContent = e.title || '';
          var span = document.createElement('span');
          span.textContent = parts ? `（${parts}）` : '';
          row.append(strong, span);
          rows.append(row);
        });
        block.append(h, rows);
        return block;
      }) : [emptyEl('目前沒有任何私人行程。')]));
      var total = overviewData.reduce(function (sum, g) { return sum + g.events.length; }, 0);
      status.textContent = `共 ${overviewData.length} 位使用者、${total} 筆私人行程。`;
      if (exportBtn) exportBtn.disabled = !total;
    } catch (error) {
      console.error('載入私人行程總覽失敗：', error);
      status.textContent = '載入失敗，請稍後再試。';
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
    $('adminOverviewLoad')?.addEventListener('click', loadOverview);
    $('adminExportAll')?.addEventListener('click', function () {
      if (overviewData) downloadCsv(`private-events-all-${todayStamp()}.csv`, eventsToCsv(overviewData));
    });
    document.querySelectorAll('[data-admin-close]').forEach(function (button) {
      button.addEventListener('click', window.calCloseAdmin);
    });
  });
})();
