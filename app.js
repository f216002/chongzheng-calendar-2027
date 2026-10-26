'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbx11UqmZ_apamVa7FU5Dp46G9DNddfIeHaohjYFrasLNaZ0QcmDmIl2ZYVmOGihET44/exec';
const PUBLIC_CALENDAR_ID = '1d311aa618934513387621d52ddaa5a4e15a5a894532b6aaeab89396fafca5e1@group.calendar.google.com';
const PRIVATE_CALENDAR_CODE = 'private';
const PRIVATE_CALENDAR_CATEGORY = Object.freeze({
  code: PRIVATE_CALENDAR_CODE,
  name: '私人',
  color: '#8C5B28',
  order: Number.MAX_SAFE_INTEGER,
  defaultSelected: false,
  virtual: true
});
const PRIVATE_STORAGE_KEY = 'chongzheng-private-events-v1';
const CENTER_CLASS_COLOR = '#B52D3A';
const REGIONAL_CLASS_COLOR = '#EC625D';
const DATA_CACHE_KEY = 'chongzheng-calendar-data-v2';
const API_SLOW_NOTICE_MS = 8000;
const API_TIMEOUT_MS = 30000;
const FONT_SCALE_KEY = 'chongzheng-calendar-font-level-v1';
const FONT_LEVELS = [
  { size: '94%', label: '較小' },
  { size: '100%', label: '標準' },
  { size: '113%', label: '放大' },
  { size: '125%', label: '特大' }
];
let currentFontLevel = 1;
let apiSlowTimer = null;
let apiTimeoutTimer = null;
let publicRefreshCompletion = null;
const CORE_CODES = new Set(['center_classes', 'shared', 'all_classes']);
const TAIWAN_CODES = new Set([
  'center_classes', 'shared', 'all_classes', 'center_routine',
  'jingming', 'dade', 'zhengzong', 'huade', 'north', 'tonghua', 'guangxiong', 'guanghui', 'guangsheng'
]);
const GLOBAL_CODES = new Set([
  'center_classes', 'shared', 'all_classes',
  'indonesia', 'malaysia_group', 'cambodia'
]);
const GLOBAL_COLUMN_MAP = { O: 'indonesia', P: 'malaysia_group', Q: 'cambodia' };
const REGION_DESCRIPTIONS = {
  taiwan: '台灣道務中心與各單位道場',
  global: '台灣道務中心與全球道場'
};
const REGIONAL_CLASS_KEYWORDS = [
  '南部進德班', '南部身心靈健康體驗營',
  '北部身心靈健康體驗營', '北部進德班'
];
const state = {
  categories: [], events: [], selected: new Set(), month: null,
  activeRegion: 'taiwan', hasRendered: false,
  privateEvents: [],
  pendingScrollDate: null,
  initialScrollDate: null,
  initialScrollMonth: null,
  daysMap: new Map()
};
const elements = {
  filters: document.querySelector('#filters'), calendar: document.querySelector('#calendar'),
  status: document.querySelector('#status'), monthLabel: document.querySelector('#monthLabel'),
  yearLabel: document.querySelector('#yearLabel'), regionDescription: document.querySelector('#regionDescription'),
  filterScrollGuide: document.querySelector('#filterScrollGuide'),
  filterScrollLeft: document.querySelector('#filterScrollLeft'),
  filterScrollRight: document.querySelector('#filterScrollRight'),
  fontSizeDecrease: document.querySelector('#fontSizeDecrease'),
  fontSizeIncrease: document.querySelector('#fontSizeIncrease'),
  fontScaleValue: document.querySelector('#fontScaleValue'),
  authGate: document.querySelector('#authGate'),
  calGoogleSignIn: document.querySelector('#calGoogleSignIn'),
  calGateSignOut: document.querySelector('#calGateSignOut'),
  accountBar: document.querySelector('#accountBar'),
  calAccountPhoto: document.querySelector('#calAccountPhoto'),
  calAccountName: document.querySelector('#calAccountName'),
  calAccountEmail: document.querySelector('#calAccountEmail'),
  calAdminButton: document.querySelector('#calAdminButton'),
  calExportMine: document.querySelector('#calExportMine'),
  addPrivateEventButton: document.querySelector('#addPrivateEventButton'),
  privateEventModal: document.querySelector('#privateEventModal'),
  privateEventClose: document.querySelector('#privateEventClose'),
  privateEventForm: document.querySelector('#privateEventForm'),
  privateTitle: document.querySelector('#privateTitle'),
  privateDate: document.querySelector('#privateDate'),
  privateStart: document.querySelector('#privateStart'),
  privateEnd: document.querySelector('#privateEnd'),
  privateLocation: document.querySelector('#privateLocation'),
  privateEventTitle: document.querySelector('#privateEventTitle'),
  privateFormDesc: document.querySelector('#privateFormDesc'),
  privateSave: document.querySelector('#privateEventForm .private-save'),
  privateDelete: document.querySelector('#privateDelete'),
  privateRecurrence: document.querySelector('#privateRecurrence'),
  privateUntil: document.querySelector('#privateUntil'),
  privateReminder: document.querySelector('#privateReminder'),
  privateMeeting: document.querySelector('#privateMeeting'),
  privateNotes: document.querySelector('#privateNotes'),
  reminderBar: document.querySelector('#reminderBar')
};

function applyFontLevel(level, save = true) {
  const safeLevel = Math.min(Math.max(Number(level) || 0, 0), FONT_LEVELS.length - 1);
  currentFontLevel = safeLevel;
  document.documentElement.dataset.fontLevel = String(safeLevel);
  if (elements.fontScaleValue) {
    elements.fontScaleValue.value = FONT_LEVELS[safeLevel].size;
    elements.fontScaleValue.textContent = FONT_LEVELS[safeLevel].size;
    elements.fontScaleValue.setAttribute(
      'aria-label',
      `目前字體：${FONT_LEVELS[safeLevel].label} ${FONT_LEVELS[safeLevel].size}`
    );
  }
  if (elements.fontSizeDecrease) elements.fontSizeDecrease.disabled = safeLevel === 0;
  if (elements.fontSizeIncrease) elements.fontSizeIncrease.disabled = safeLevel === FONT_LEVELS.length - 1;
  if (save) {
    try {
      localStorage.setItem(FONT_SCALE_KEY, String(safeLevel));
    } catch (error) {
      console.warn('無法儲存字體大小設定：', error);
    }
  }
  requestAnimationFrame(() => {
    updateFilterScrollGuide();
    window.dispatchEvent(new Event('resize'));
  });
}

function initializeFontLevel() {
  let savedLevel = 1;
  try {
    const stored = Number(localStorage.getItem(FONT_SCALE_KEY));
    if (Number.isInteger(stored)) savedLevel = stored;
  } catch (error) {
    console.warn('無法讀取字體大小設定：', error);
  }
  applyFontLevel(savedLevel, false);
}

function changeFontLevel(offset) {
  applyFontLevel(currentFontLevel + offset);
}

window.loadCalendarData = function (payload) {
  clearApiTimers();
  if (!payload || !payload.success) {
    const error = new Error(payload?.error || '資料格式不正確');
    if (!state.hasRendered) showError(error.message);
    settlePublicRefresh(error);
    return;
  }
  try {
    applyCalendarData(payload, state.hasRendered);
    saveCachedData(payload);
    settlePublicRefresh();
  } catch (error) {
    console.error('套用行事曆資料失敗：', error);
    settlePublicRefresh(error);
  }
};

function settlePublicRefresh(error = null) {
  if (!publicRefreshCompletion) return;
  const completion = publicRefreshCompletion;
  publicRefreshCompletion = null;
  error ? completion.reject(error) : completion.resolve();
}

function refreshPublicCalendarData() {
  return new Promise((resolve, reject) => {
    publicRefreshCompletion = { resolve, reject };
    loadData({ force: true, showLoading: false });
  });
}

function applyCalendarData(payload, preserveView = false) {
  state.categories = [...payload.categories].map(normalizeCategory).sort((a, b) => a.order - b.order);
  state.events = payload.events.map(normalizeEvent).filter(event => event.date);
  state.daysMap = new Map((payload.days || []).map(day => [day.date, day]));
  if (!preserveView) {
    state.selected = new Set(state.categories.filter(item => item.defaultSelected).map(item => item.code));
    state.selected.add(PRIVATE_CALENDAR_CODE);
    const sortedDates = state.events.map(item => item.date).sort();
    const firstDate = sortedDates[0] || '2027-01-01';
    const lastDate = sortedDates[sortedDates.length - 1] || firstDate;
    const now = new Date();
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const firstMonth = firstDate.slice(0, 7);
    const lastMonth = lastDate.slice(0, 7);
    const todayMonth = todayIso.slice(0, 7);
    /* 開啟時定位到今天：開啟今天所在月份（超出資料範圍時夾到最近的月份），
       繪製後把今天（或今天之後最近）的日期卡捲到最上方，前後日期仍可滑動查看。 */
    state.month = todayMonth < firstMonth ? firstMonth : (todayMonth > lastMonth ? lastMonth : todayMonth);
    state.pendingScrollDate = todayIso;
    state.initialScrollDate = todayIso;
    state.initialScrollMonth = state.month;
  }
  state.hasRendered = true;
  renderRegionTabs();
  renderFilters();
  renderCalendar();
}

function saveCachedData(payload) {
  try {
    localStorage.setItem(DATA_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      payload
    }));
  } catch (error) {
    console.warn('無法儲存本機行事曆快取：', error);
  }
}

function loadCachedData() {
  try {
    const cached = JSON.parse(localStorage.getItem(DATA_CACHE_KEY) || 'null');
    if (!cached?.payload?.success) return false;
    applyCalendarData(cached.payload, false);
    return true;
  } catch (error) {
    localStorage.removeItem(DATA_CACHE_KEY);
    return false;
  }
}

function clearApiTimers() {
  clearTimeout(apiSlowTimer);
  clearTimeout(apiTimeoutTimer);
  apiSlowTimer = null;
  apiTimeoutTimer = null;
}

function normalizeCategory(category) {
  const sourceColumn = String(category.sourceColumn || '').toUpperCase();
  const inferredCode = GLOBAL_COLUMN_MAP[sourceColumn];
  return inferredCode && !GLOBAL_CODES.has(category.code)
    ? { ...category, code: inferredCode, originalCode: category.code }
    : category;
}

function normalizeEvent(event) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ''))
    ? event.date : isoFromTimestamp(event.dateDisplay);
  const category = categoryCodeForEvent(event);
  return { ...event, category, date, lunar: cleanDisplayDate(event.lunar, true) };
}

function categoryCodeForEvent(event) {
  const sourceColumn = String(event.sourceColumn || '').toUpperCase();
  return GLOBAL_COLUMN_MAP[sourceColumn] || event.category;
}

function isoFromTimestamp(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

function cleanDisplayDate(value, lunar = false) {
  const text = String(value || '');
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return text;
  const date = new Date(text);
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric'
  }).format(date);
  return lunar ? parts : `${date.getFullYear()}/${parts}`;
}

function loadData({ force = false, showLoading = !state.hasRendered } = {}) {
  clearApiTimers();
  if (showLoading) {
    elements.status.hidden = false;
    elements.status.className = 'status';
    elements.status.textContent = '正在讀取最新行事曆…';
  }
  document.querySelector('#calendarApi')?.remove();
  const script = document.createElement('script');
  script.id = 'calendarApi';
  const refreshToken = force ? `&t=${Date.now()}` : '';
  script.src = `${API_URL}?callback=loadCalendarData${refreshToken}`;
  script.onerror = () => {
    clearApiTimers();
    const error = new Error('目前無法連接行事曆資料，請稍後再試。');
    if (!state.hasRendered) showError(error.message);
    settlePublicRefresh(error);
  };
  document.body.appendChild(script);

  apiSlowTimer = setTimeout(() => {
    if (!state.hasRendered) {
      elements.status.textContent = 'Google 伺服器正在啟動，第一次載入可能較久，請稍候…';
    }
  }, API_SLOW_NOTICE_MS);

  apiTimeoutTimer = setTimeout(() => {
    const error = new Error('資料讀取逾時，請檢查網路後再試。');
    if (!state.hasRendered) {
      showError('資料讀取逾時，請檢查網路後點擊右上角「更新資料」重試。');
    }
    settlePublicRefresh(error);
  }, API_TIMEOUT_MS);
}

function categoriesForRegion(region = state.activeRegion) {
  const codes = region === 'global' ? GLOBAL_CODES : TAIWAN_CODES;
  const list = state.categories.filter(category => codes.has(category.code));
  /* 「私人」固定排在「仙佛聖誕/節日活動/開會」之後（Cheng 2026-10-21 指定）。 */
  const sharedIndex = list.findIndex(category => category.code === 'shared');
  list.splice(sharedIndex >= 0 ? sharedIndex + 1 : list.length, 0, PRIVATE_CALENDAR_CATEGORY);
  return list;
}

function categoryByCode(code) {
  if (code === PRIVATE_CALENDAR_CODE) return PRIVATE_CALENDAR_CATEGORY;
  return state.categories.find(item => item.code === code);
}

function weekdayForDate(date) {
  return new Intl.DateTimeFormat('zh-TW', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

/* ================= 私人行程（Firestore，每人獨立空間） =================
   資料存放在 cal_users/{uid}/privateEvents，只有本人（與管理員）可存取，
   不會與其他人的行程混在一起。讀寫一律先經 cal-access 審核狀態把關。 */
let privateStore = [];
let editingPrivateId = null;
let privateLoadedForUid = '';

const RECURRENCE_LABELS = { weekly: '每週', monthly: '每月', yearly: '每年' };
const PRIVATE_EXPAND_CAP = '2028-12-31';

function addDaysIso(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/* 把週期行程展開成每一場的日期（上限 120 場或至 2028 年底）。 */
function expandPrivateDates(raw) {
  const start = raw.date;
  const freq = raw.recurrence || 'none';
  if (!start) return [];
  if (freq === 'none') return [start];
  const until = raw.recurrenceUntil && raw.recurrenceUntil >= start
    ? raw.recurrenceUntil : PRIVATE_EXPAND_CAP;
  const dates = [];
  if (freq === 'weekly') {
    for (let d = start; d <= until && dates.length < 120; d = addDaysIso(d, 7)) dates.push(d);
  } else if (freq === 'monthly') {
    const [y, m, day] = start.split('-').map(Number);
    for (let i = 0; i < 36 && dates.length < 120; i++) {
      const base = new Date(Date.UTC(y, m - 1 + i, 1));
      const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
      if (day > lastDay) continue;
      const iso = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso > until) break;
      dates.push(iso);
    }
  } else if (freq === 'yearly') {
    const [y, m, day] = start.split('-').map(Number);
    for (let i = 0; i < 5; i++) {
      const iso = `${y + i}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const check = new Date(`${iso}T00:00:00Z`);
      if (check.getUTCMonth() !== m - 1) continue; /* 2/29 非閏年略過 */
      if (iso > until) break;
      dates.push(iso);
    }
  }
  return dates;
}

function addMinutesToTime(time, mins) {
  const [h, m] = String(time).split(':').map(Number);
  const total = ((h * 60 + m + mins) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function googleTemplateUrl(event) {
  const params = new URLSearchParams({ action: 'TEMPLATE', text: event.name });
  const compact = event.date.replaceAll('-', '');
  if (event.startTimeRaw) {
    const endTime = event.endTimeRaw && event.endTimeRaw > event.startTimeRaw
      ? event.endTimeRaw : addMinutesToTime(event.startTimeRaw, 60);
    params.set('dates', `${compact}T${event.startTimeRaw.replace(':', '')}00/${compact}T${endTime.replace(':', '')}00`);
  } else {
    params.set('dates', `${compact}/${addDaysIso(event.date, 1).replaceAll('-', '')}`);
  }
  const details = [event.notes,
    event.meetingLink ? `會議連結：${event.meetingLink}` : ''].filter(Boolean).join('\n');
  if (details) params.set('details', details);
  if (event.location) params.set('location', event.location);
  if (event.isSeriesStart && event.recurrence && event.recurrence !== 'none') {
    const freq = { weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' }[event.recurrence];
    if (freq) params.set('recur', `RRULE:FREQ=${freq}`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function normalizePrivateEvent(raw, date) {
  const timeText = raw.startTime && raw.endTime
    ? `${raw.startTime}-${raw.endTime}` : (raw.startTime || raw.endTime || '');
  const [hh, mm] = String(raw.startTime || '12:00').split(':').map(Number);
  return {
    id: `private-${raw.id}-${date}`,
    rawId: raw.id,
    name: String(raw.title || ''),
    date,
    weekday: weekdayForDate(date),
    lunar: '',
    week: '',
    category: PRIVATE_CALENDAR_CODE,
    categoryName: '私人',
    order: 900000 + (Number.isFinite(hh) ? hh * 60 + (mm || 0) : 720),
    privateLocal: true,
    timeText,
    location: String(raw.location || ''),
    meetingLink: String(raw.meetingLink || ''),
    notes: String(raw.notes || ''),
    recurrence: raw.recurrence || 'none',
    recurrenceLabel: RECURRENCE_LABELS[raw.recurrence] || '',
    reminder: raw.reminder || 'none',
    startTimeRaw: raw.startTime || '',
    endTimeRaw: raw.endTime || '',
    isSeriesStart: date === raw.date
  };
}

function refreshPrivateEvents() {
  state.privateEvents = privateStore.flatMap(raw =>
    expandPrivateDates(raw).map(date => normalizePrivateEvent(raw, date)));
}

/* ---------- 私人行程提醒（網站開啟時顯示；裝置提醒靠 Google 日曆連結） ---------- */
const REMINDER_DISMISS_KEY = 'chongzheng-reminder-dismissed-v1';
let reminderTimerStarted = false;

function occurrenceStart(event) {
  const [h, m] = (event.startTimeRaw || '09:00').split(':').map(Number);
  return new Date(`${event.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
}

function reminderTimeFor(event, start) {
  switch (event.reminder) {
    case '10m': return new Date(start.getTime() - 10 * 60000);
    case '30m': return new Date(start.getTime() - 30 * 60000);
    case '1h': return new Date(start.getTime() - 3600000);
    case '1d9': { const d = new Date(start); d.setDate(d.getDate() - 1); d.setHours(9, 0, 0, 0); return d; }
    case '0d9': { const d = new Date(start); d.setHours(9, 0, 0, 0); return d; }
    default: return null;
  }
}

function checkPrivateReminders() {
  if (!elements.reminderBar) return;
  let dismissed = new Set();
  try { dismissed = new Set(JSON.parse(localStorage.getItem(REMINDER_DISMISS_KEY) || '[]')); } catch (error) {}
  const now = new Date();
  const due = [];
  state.privateEvents.forEach(event => {
    if (!event.reminder || event.reminder === 'none') return;
    const start = occurrenceStart(event);
    const remindAt = reminderTimeFor(event, start);
    if (!remindAt) return;
    const key = `${event.id}@${remindAt.getTime()}`;
    if (dismissed.has(key)) return;
    if (now >= remindAt && start.getTime() >= now.getTime() - 30 * 60000) {
      due.push({ event, key });
    }
  });
  if (!due.length) {
    elements.reminderBar.hidden = true;
    elements.reminderBar.replaceChildren();
    return;
  }
  elements.reminderBar.replaceChildren(...due.map(({ event, key }) => {
    const item = document.createElement('div');
    item.className = 'reminder-item';
    const text = document.createElement('span');
    const when = event.timeText ? `${event.date.replaceAll('-', '/')} ${event.timeText}` : event.date.replaceAll('-', '/');
    text.textContent = `🔔 提醒：${when} ${event.name}${event.location ? `（${event.location}）` : ''}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'reminder-dismiss';
    close.textContent = '×';
    close.setAttribute('aria-label', '關閉這則提醒');
    close.addEventListener('click', () => {
      dismissed.add(key);
      try {
        localStorage.setItem(REMINDER_DISMISS_KEY, JSON.stringify([...dismissed].slice(-100)));
      } catch (error) {}
      checkPrivateReminders();
    });
    item.append(text, close);
    return item;
  }));
  elements.reminderBar.hidden = false;
}

function startReminderTimer() {
  if (reminderTimerStarted) return;
  reminderTimerStarted = true;
  checkPrivateReminders();
  setInterval(checkPrivateReminders, 60000);
}

async function loadPrivateEventsFromFirestore() {
  const access = window.CAL_ACCESS;
  if (!access || access.status !== 'approved' || !access.user || !window.CAL_DB) return;
  const uid = access.user.uid;
  if (privateLoadedForUid === uid) return;
  privateLoadedForUid = uid;
  try {
    const snap = await window.CAL_DB.collection('cal_users').doc(uid)
      .collection('privateEvents').get();
    privateStore = snap.docs.map(doc => ({ ...doc.data(), id: doc.id }));
    privateStore.sort((a, b) =>
      String(a.date).localeCompare(String(b.date)) ||
      String(a.startTime || '').localeCompare(String(b.startTime || '')));
    refreshPrivateEvents();
    if (state.privateEvents.length) state.selected.add(PRIVATE_CALENDAR_CODE);
    if (state.hasRendered) {
      renderFilters();
      renderCalendar();
    }
    finalizeInitialScroll();
    startReminderTimer();
  } catch (error) {
    console.error('讀取私人行程失敗：', error);
    privateLoadedForUid = '';
    finalizeInitialScroll();
  }
}

function clearPrivateEvents() {
  privateStore = [];
  privateLoadedForUid = '';
  refreshPrivateEvents();
}

async function removePrivateEvent(rawId) {
  try {
    const user = window.calRequireApproved();
    await window.CAL_DB.collection('cal_users').doc(user.uid)
      .collection('privateEvents').doc(rawId).delete();
    privateStore = privateStore.filter(item => item.id !== rawId);
    refreshPrivateEvents();
    renderCalendar();
  } catch (error) {
    window.alert(error.message || '刪除失敗，請稍後再試。');
  }
}

function openPrivateEventModal(rawId) {
  if (!elements.privateEventModal) return;
  const editRaw = typeof rawId === 'string'
    ? privateStore.find(item => item.id === rawId) : null;
  editingPrivateId = editRaw ? editRaw.id : null;
  elements.privateEventForm?.reset();
  const now = new Date();
  const localToday = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (editRaw) {
    elements.privateEventTitle.textContent = '編輯私人行程';
    if (elements.privateSave) elements.privateSave.textContent = '儲存修改';
    elements.privateTitle.value = editRaw.title || '';
    elements.privateDate.value = editRaw.date || '';
    elements.privateStart.value = editRaw.startTime || '';
    elements.privateEnd.value = editRaw.endTime || '';
    elements.privateLocation.value = editRaw.location || '';
    elements.privateRecurrence.value = editRaw.recurrence || 'none';
    elements.privateUntil.value = editRaw.recurrenceUntil || '';
    elements.privateReminder.value = editRaw.reminder || 'none';
    elements.privateMeeting.value = editRaw.meetingLink || '';
    elements.privateNotes.value = editRaw.notes || '';
    elements.privateFormDesc.textContent = editRaw.recurrence && editRaw.recurrence !== 'none'
      ? '正在編輯週期行程：修改會套用到整個系列。'
      : '正在編輯私人行程。';
    elements.privateDelete.hidden = false;
  } else {
    elements.privateEventTitle.textContent = '新增行事曆';
    if (elements.privateSave) elements.privateSave.textContent = '儲存';
    elements.privateFormDesc.textContent = '新增的行程會存入「私人」分類，只有您自己的帳號看得到。';
    elements.privateDelete.hidden = true;
    if (elements.privateDate) elements.privateDate.value = localToday;
  }
  elements.privateEventModal.hidden = false;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => elements.privateTitle?.focus());
}

function closePrivateEventModal() {
  if (!elements.privateEventModal || elements.privateEventModal.hidden) return;
  elements.privateEventModal.hidden = true;
  document.body.classList.remove('modal-open');
  elements.addPrivateEventButton?.focus();
}

async function handlePrivateEventSubmit(submitEvent) {
  submitEvent.preventDefault();
  const title = elements.privateTitle.value.trim();
  const date = elements.privateDate.value;
  const startTime = elements.privateStart.value;
  const endTime = elements.privateEnd.value;
  const location = elements.privateLocation.value.trim();
  const recurrence = elements.privateRecurrence.value || 'none';
  const recurrenceUntil = recurrence === 'none' ? '' : (elements.privateUntil.value || '');
  const reminder = elements.privateReminder.value || 'none';
  let meetingLink = elements.privateMeeting.value.trim();
  if (meetingLink && !/^https?:\/\//i.test(meetingLink)) meetingLink = `https://${meetingLink}`;
  const notes = elements.privateNotes.value.trim();
  if (!title || !date) return;
  if (startTime && endTime && endTime <= startTime) {
    window.alert('結束時間需晚於開始時間，請再確認。');
    return;
  }
  const saveButton = elements.privateEventForm.querySelector('.private-save');
  try {
    const user = window.calRequireApproved();
    if (saveButton) saveButton.disabled = true;
    const plain = { title, date, startTime, endTime, location,
      recurrence, recurrenceUntil, reminder, meetingLink, notes };
    const col = window.CAL_DB.collection('cal_users').doc(user.uid)
      .collection('privateEvents');
    if (editingPrivateId) {
      await col.doc(editingPrivateId).set({
        ...plain,
        updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      const idx = privateStore.findIndex(item => item.id === editingPrivateId);
      if (idx >= 0) privateStore[idx] = { ...privateStore[idx], ...plain };
    } else {
      const ref = await col.add({
        ...plain,
        createdAt: window.firebase.firestore.FieldValue.serverTimestamp()
      });
      privateStore.push({ ...plain, id: ref.id, createdAt: Date.now() });
    }
    refreshPrivateEvents();
    closePrivateEventModal();
    state.selected.add(PRIVATE_CALENDAR_CODE);
    state.month = date.slice(0, 7);
    renderFilters();
    renderCalendar();
  } catch (error) {
    window.alert(error.message || '儲存失敗，請稍後再試。');
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

/* ================= 登入閘門（比照 V4：未核准不載入任何資料） ================= */
let calendarBootStarted = false;

function startCalendarOnce() {
  if (calendarBootStarted) return;
  calendarBootStarted = true;
  const hasCache = loadCachedData();
  const forceRefresh = new URLSearchParams(window.location.search).has('refresh');
  loadData({ force: forceRefresh, showLoading: !hasCache });
  loadPrivateEventsFromFirestore();
}

function setGateMessage(message) {
  if (window.calSetAuthMessage) window.calSetAuthMessage(message);
}

function handleAccessChanged() {
  const access = window.CAL_ACCESS;
  if (!access || !elements.authGate) return;
  const user = access.user;
  if (access.status === 'approved' && user) {
    elements.authGate.hidden = true;
    document.body.classList.remove('gate-open');
    elements.accountBar.hidden = false;
    elements.calAccountName.textContent = user.displayName || '使用者';
    elements.calAccountEmail.textContent = user.email || '';
    if (user.photoURL) {
      elements.calAccountPhoto.src = user.photoURL;
      elements.calAccountPhoto.hidden = false;
    } else {
      elements.calAccountPhoto.hidden = true;
    }
    elements.calAdminButton.hidden = !access.isAdmin;
    setGateMessage('');
    startCalendarOnce();
    loadPrivateEventsFromFirestore();
    return;
  }
  /* 未核准（含未登入）：閘門擋住內容；若先前有登入者的私人行程，先清掉避免外洩。 */
  if (privateLoadedForUid) {
    clearPrivateEvents();
    if (state.hasRendered) renderCalendar();
  }
  elements.accountBar.hidden = true;
  elements.authGate.hidden = false;
  document.body.classList.add('gate-open');
  if (window.calSetSigningInMode) {
    window.calSetSigningInMode(access.status === 'checking' && Boolean(user));
  }
  const signedIn = Boolean(user);
  elements.calGoogleSignIn.hidden = signedIn;
  elements.calGateSignOut.hidden = !signedIn;
  if (access.status === 'checking') setGateMessage('正在確認登入狀態…');
  else if (access.status === 'pending') setGateMessage(`您好，${user.displayName || user.email}。您的使用申請已送出，待管理員核准後即可使用本行事曆。`);
  else if (access.status === 'rejected') setGateMessage('您的申請未通過核准，請聯繫管理員。');
  else if (access.status === 'suspended') setGateMessage('您的帳號目前暫停使用，請聯繫管理員。');
  else if (access.status === 'error') setGateMessage('登入狀態確認失敗，請重新整理頁面再試。');
  else setGateMessage('');
}

function renderRegionTabs() {
  document.querySelectorAll('.region-tab').forEach(button => {
    const active = button.dataset.region === state.activeRegion;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  elements.regionDescription.textContent = REGION_DESCRIPTIONS[state.activeRegion];
}

function renderFilters() {
  elements.filters.replaceChildren(...categoriesForRegion().map(category => {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-chip';
    wrapper.style.setProperty('--chip-color', categoryDisplayColor(category));
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = `filter-${state.activeRegion}-${category.code}`; input.value = category.code;
    input.checked = state.selected.has(category.code);
    input.addEventListener('change', () => {
      input.checked ? state.selected.add(category.code) : state.selected.delete(category.code);
      renderCalendar();
    });
    const label = document.createElement('label');
    label.htmlFor = input.id;
    label.textContent = category.name;
    wrapper.append(input, label);
    return wrapper;
  }));
  elements.filters.scrollLeft = 0;
  requestAnimationFrame(updateFilterScrollGuide);
}

function updateFilterScrollGuide() {
  if (!elements.filterScrollGuide) return;
  const maxScroll = Math.max(0, elements.filters.scrollWidth - elements.filters.clientWidth);
  const canScroll = maxScroll > 3;
  elements.filterScrollGuide.classList.toggle('is-hidden', !canScroll);
  elements.filterScrollLeft.disabled = !canScroll || elements.filters.scrollLeft <= 3;
  elements.filterScrollRight.disabled = !canScroll || elements.filters.scrollLeft >= maxScroll - 3;
}

function scrollFilters(direction) {
  const distance = Math.max(220, elements.filters.clientWidth * 0.72);
  elements.filters.scrollBy({ left: direction * distance, behavior: 'smooth' });
}

function isVisible(event) {
  return state.selected.has(event.category) || (state.selected.has('all_classes') && event.isAllClass);
}

function isCoreEvent(event) {
  return event.category === 'center_classes' || event.category === 'shared' ||
    (state.selected.has('all_classes') && event.isAllClass);
}

function getSearchExpression() {
  const terms = [1, 2].map(index =>
    document.querySelector(`#keyword${index}`).value.trim().toLocaleLowerCase('zh-Hant')
  );
  return { terms, operator: document.querySelector('#operator2').value };
}

function hasActiveSearch() {
  return getSearchExpression().terms.some(Boolean);
}

function matchesAdvancedSearch(event) {
  const { terms, operator } = getSearchExpression();
  const [firstTerm, secondTerm] = terms;
  if (!firstTerm && !secondTerm) return true;

  const category = categoryByCode(event.category);
  const haystack = [
    event.name, event.date, event.dateDisplay, event.week, event.weekday, event.lunar,
    event.venue, event.categoryName, category?.name, conciseEventLabel(event, category)
  ].filter(Boolean).join(' ').toLocaleLowerCase('zh-Hant');

  const firstMatches = firstTerm ? haystack.includes(firstTerm) : true;
  const secondMatches = secondTerm ? haystack.includes(secondTerm) : false;

  if (!firstTerm) return operator === 'EXCLUDED' ? !secondMatches : secondMatches;
  if (!secondTerm) return firstMatches;
  if (operator === 'OR') return firstMatches || secondMatches;
  if (operator === 'EXCLUDED') return firstMatches && !secondMatches;
  return firstMatches && secondMatches;
}

function getVisibleEvents() {
  const searching = hasActiveSearch();
  return [...state.events, ...state.privateEvents].filter(event =>
    (searching || event.date.startsWith(state.month)) &&
    isVisible(event) &&
    matchesAdvancedSearch(event)
  );
}

function renderCalendar() {
  const [year, month] = state.month.split('-').map(Number);
  const searching = hasActiveSearch();
  elements.yearLabel.textContent = searching ? '目前已勾選分類' : `${year} 年`;
  elements.monthLabel.textContent = searching ? '全年度搜尋結果' : `${month} 月`;
  document.querySelector('#previousMonth').disabled = searching;
  document.querySelector('#nextMonth').disabled = searching;
  const visible = getVisibleEvents();
  const grouped = Map.groupBy ? Map.groupBy(visible, event => event.date) : groupByDate(visible);
  let cards;
  if (!searching && state.selected.size) {
    /* 月份檢視補齊當月每一天：無活動的日期也顯示日期卡（Cheng 2026-10-22）。 */
    cards = datesOfMonth(state.month).map(date => createDateCard(date, grouped.get(date) || []));
  } else {
    cards = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => createDateCard(date, events));
  }
  elements.calendar.replaceChildren(...(cards.length ? cards : [emptyMessage()]));
  elements.status.hidden = true;
  sizeCalendarRegion();
  if (state.pendingScrollDate) {
    /* 開啟預設今天（Cheng 2026-10-26）：先把整頁捲到月份欄貼頂（月份為分界線），
       再把卡片區塊內捲到今天的卡；資料兩次載入不再洗掉位置，因定位只在 pending 時執行一次。 */
    state.pendingScrollDate = null;
    scrollToTodayCard();
  }
}

/* 登入預設今天（Cheng 2026-10-26）：整頁捲到月份欄貼頂＋卡片區塊內捲到今天的卡。
   私人行程是非同步載入、會改變今天之前卡片的高度，第一次定位可能被位移洗掉，
   因此在私人行程結算（成功或失敗）後、且使用者尚未切換月份或搜尋時，再確認一次。 */
let initialScrollFinalized = false;
function scrollToTodayCard() {
  const targetDate = state.initialScrollDate || (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const cards = [...elements.calendar.querySelectorAll('.date-card')];
  const target = cards.find(card => card.dataset.date >= targetDate) || cards[cards.length - 1];
  if (!target) return;
  requestAnimationFrame(() => {
    const toolbar = document.querySelector('.calendar-toolbar');
    if (toolbar) window.scrollTo({ top: toolbar.getBoundingClientRect().top + window.scrollY, behavior: 'auto' });
    requestAnimationFrame(() => {
      const region = elements.calendar.getBoundingClientRect();
      elements.calendar.scrollTop += target.getBoundingClientRect().top - region.top;
    });
  });
}
function finalizeInitialScroll() {
  if (initialScrollFinalized || !state.hasRendered) return;
  if (state.initialScrollMonth && state.month !== state.initialScrollMonth) { initialScrollFinalized = true; return; }
  if (typeof hasActiveSearch === 'function' && hasActiveSearch()) { initialScrollFinalized = true; return; }
  initialScrollFinalized = true;
  scrollToTodayCard();
}

/* 行事曆卡獨立區塊高度：視窗高度扣掉月份欄高度與欄下間距（Cheng 2026-10-26）。 */
function sizeCalendarRegion() {
  const toolbar = document.querySelector('.calendar-toolbar');
  if (!toolbar || !elements.calendar) return;
  elements.calendar.style.height = `${Math.max(240, window.innerHeight - toolbar.offsetHeight - 16)}px`;
}
window.addEventListener('resize', sizeCalendarRegion);

function groupByDate(events) {
  const map = new Map();
  events.forEach(event => map.set(event.date, [...(map.get(event.date) || []), event]));
  return map;
}

function datesOfMonth(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const dates = [];
  for (let day = 1; day <= lastDay; day += 1) {
    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  return dates;
}

function weekdayName(isoDate) {
  const names = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  const [year, month, day] = isoDate.split('-').map(Number);
  return names[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
}

function createDateCard(date, events) {
  const card = document.createElement('article'); card.className = 'date-card';
  card.dataset.date = date;
  const meta = document.createElement('div'); meta.className = 'date-meta';
  const time = document.createElement('time'); time.dateTime = date; time.textContent = date.replaceAll('-', '/');
  const dayInfo = events[0] || state.daysMap.get(date) || {};
  const weekday = document.createElement('span'); weekday.className = 'weekday'; weekday.textContent = dayInfo.weekday || weekdayName(date);
  const lunar = document.createElement('div'); lunar.className = 'lunar'; lunar.textContent = `農曆 ${dayInfo.lunar || '—'}`;
  const week = document.createElement('div'); week.className = 'week'; week.textContent = dayInfo.week || '';
  meta.append(time, weekday, lunar, week);

  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'day-empty';
    empty.textContent = '此日無行程';
    card.append(meta, empty);
    return card;
  }

  const columns = document.createElement('div'); columns.className = 'event-columns';
  const core = createEventColumn('共同核心活動', 'core-events');
  const regional = createEventColumn('各單位課程與活動', 'regional-events');
  events.sort((a, b) => a.order - b.order).forEach(event => {
    (isCoreEvent(event) ? core.list : regional.list).append(createEvent(event));
  });
  core.column.classList.toggle('column-empty', !core.list.childElementCount);
  regional.column.classList.toggle('column-empty', !regional.list.childElementCount);
  columns.append(core.column, regional.column);
  card.append(meta, columns); return card;
}

function createEventColumn(title, className) {
  const column = document.createElement('section');
  column.className = `event-column ${className}`;
  column.setAttribute('aria-label', title);
  const list = document.createElement('div');
  list.className = 'events';
  column.append(list);
  return { column, list };
}

function createEvent(event) {
  const category = categoryByCode(event.category);
  const item = document.createElement('div'); item.className = 'event';
  item.dataset.eventId = String(event.id || event.event_id || `${event.date}-${event.order}-${event.name}`);
  item.style.setProperty('--event-color', eventDisplayColor(event, category));
  if (event.privateLocal) item.style.setProperty('--event-color', '#F0B429'); /* 私人行程改亮金色（Cheng 2026-10-26），與深棕原色區分 */
  const name = document.createElement('p'); name.className = 'event-name'; name.textContent = event.name;
  const categoryName = document.createElement('p'); categoryName.className = 'event-category';
  categoryName.textContent = conciseEventLabel(event, category);
  item.append(name, categoryName);
  if (event.privateLocal) {
    item.classList.add('private-event');
    const metaParts = [event.timeText, event.location,
      event.recurrenceLabel ? `🔁 ${event.recurrenceLabel}` : ''].filter(Boolean);
    if (metaParts.length) {
      const meta = document.createElement('p'); meta.className = 'event-meta';
      meta.textContent = metaParts.join(' · ');
      item.insertBefore(meta, categoryName);
    }
    if (event.meetingLink) {
      const meeting = document.createElement('a');
      meeting.className = 'event-meeting';
      meeting.href = event.meetingLink;
      meeting.target = '_blank';
      meeting.rel = 'noopener noreferrer';
      meeting.textContent = '🎥 加入線上會議';
      meeting.addEventListener('click', clickEvent => clickEvent.stopPropagation());
      item.append(meeting);
    }
    const gcal = document.createElement('a');
    gcal.className = 'event-gcal';
    gcal.href = googleTemplateUrl(event);
    gcal.target = '_blank';
    gcal.rel = 'noopener noreferrer';
    gcal.textContent = '＋ Google 日曆';
    gcal.title = '加入自己的 Google 日曆，由手機發出提醒';
    gcal.addEventListener('click', clickEvent => clickEvent.stopPropagation());
    item.append(gcal);
    if (event.notes) {
      const notes = document.createElement('p'); notes.className = 'event-notes';
      notes.textContent = event.notes;
      item.append(notes);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'private-event-edit';
    edit.textContent = '✎';
    edit.title = '編輯這筆私人行程';
    edit.setAttribute('aria-label', `編輯私人行程 ${event.name}`);
    edit.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      openPrivateEventModal(event.rawId);
    });
    item.append(edit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'private-event-delete';
    remove.textContent = '×';
    remove.title = '刪除這筆私人行程';
    remove.setAttribute('aria-label', `刪除私人行程 ${event.name}`);
    remove.addEventListener('click', clickEvent => {
      clickEvent.stopPropagation();
      const message = event.recurrence && event.recurrence !== 'none'
        ? `確定要刪除私人行程「${event.name}」整個週期系列嗎？`
        : `確定要刪除私人行程「${event.name}」嗎？`;
      if (window.confirm(message)) removePrivateEvent(event.rawId);
    });
    item.append(remove);
  }
  return item;
}

function conciseEventLabel(event, category) {
  if (event.category === PRIVATE_CALENDAR_CODE) return '私人';
  const eventName = String(event.name || '');
  if (eventName.startsWith('印尼棉蘭')) return '印尼棉蘭';
  if (eventName.startsWith('孟加拉')) return '孟加拉';
  if (eventName.startsWith('馬來')) return '馬來西亞';
  if (eventName.startsWith('柬埔寨')) return '柬埔寨';
  if (event.venue) return String(event.venue).trim();
  return String(category?.name || event.categoryName || '')
    .replace(/課程與活動/g, '')
    .replace(/人事課[／/]月懺[／/]活動/g, '')
    .replace(/仙佛班/g, '')
    .replace(/[／/]+$/g, '')
    .trim() || '共同';
}

function categoryDisplayColor(category) {
  return category?.code === 'center_classes' ? CENTER_CLASS_COLOR : (category?.color || '#315e78');
}

function eventDisplayColor(event, category) {
  if (event.category === 'center_classes') return CENTER_CLASS_COLOR;
  if (REGIONAL_CLASS_KEYWORDS.some(keyword => String(event.name || '').includes(keyword))) return REGIONAL_CLASS_COLOR;
  return categoryDisplayColor(category);
}

function emptyMessage() {
  const div = document.createElement('div'); div.className = 'empty';
  div.textContent = state.selected.size ? '本月在目前選擇的分類中沒有活動。' : '請先選擇至少一個行事曆分類。';
  return div;
}

function changeMonth(offset) {
  const [year, month] = state.month.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + offset, 1));
  state.month = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  initialScrollFinalized = true; /* 使用者已切換月份，不再拉回今天 */
  renderCalendar();
  elements.calendar.scrollTop = 0; /* 切換月份從該月 1 號看起 */
}

function updateRegionSelection(select) {
  categoriesForRegion().forEach(category => {
    select ? state.selected.add(category.code) : state.selected.delete(category.code);
  });
  renderFilters(); renderCalendar();
}

function resetToDefaultSelection() {
  const keepPrivate = state.selected.has(PRIVATE_CALENDAR_CODE);
  state.selected = new Set(
    state.categories.filter(category => category.defaultSelected).map(category => category.code)
  );
  if (keepPrivate) state.selected.add(PRIVATE_CALENDAR_CODE);
}

document.querySelectorAll('.region-tab').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.region === state.activeRegion) return;
  state.activeRegion = button.dataset.region;
  resetToDefaultSelection();
  renderRegionTabs(); renderFilters(); renderCalendar();
}));
elements.fontSizeDecrease?.addEventListener('click', () => changeFontLevel(-1));
elements.fontSizeIncrease?.addEventListener('click', () => changeFontLevel(1));
elements.calAdminButton?.addEventListener('click', () => window.calOpenAdmin?.());
elements.calExportMine?.addEventListener('click', () => {
  if (!privateStore.length) {
    window.alert('目前沒有私人行程可匯出。');
    return;
  }
  const user = window.CAL_ACCESS?.user || {};
  const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const recLabels = { none: '不重複', weekly: '每週', monthly: '每月', yearly: '每年' };
  const remLabels = { none: '不提醒', '10m': '開始前10分鐘', '30m': '開始前30分鐘', '1h': '開始前1小時', '1d9': '前一天上午9點', '0d9': '當天上午9點' };
  const header = ['使用者姓名', '使用者Email', '內容', '日期', '開始時間', '結束時間', '地點', '週期', '重複至', '提醒', '會議連結', '備註'];
  const rows = [...privateStore]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.startTime || '').localeCompare(String(b.startTime || '')))
    .map(e => [user.displayName || '', user.email || '', e.title || '', e.date || '',
      e.startTime || '', e.endTime || '', e.location || '',
      recLabels[e.recurrence || 'none'], e.recurrenceUntil || '',
      remLabels[e.reminder || 'none'], e.meetingLink || '', e.notes || ''].map(cell).join(','));
  const csv = '\uFEFF' + [header.map(cell).join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const now = new Date();
  a.href = url;
  a.download = `my-private-events-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closePrivateEventModal();
    window.calCloseAdmin?.();
  }
});
elements.addPrivateEventButton?.addEventListener('click', openPrivateEventModal);
elements.privateEventClose?.addEventListener('click', closePrivateEventModal);
document.querySelectorAll('[data-private-close]').forEach(button => {
  button.addEventListener('click', closePrivateEventModal);
});
elements.privateEventForm?.addEventListener('submit', handlePrivateEventSubmit);
elements.privateDelete?.addEventListener('click', () => {
  if (!editingPrivateId) return;
  const raw = privateStore.find(item => item.id === editingPrivateId);
  const message = raw && raw.recurrence && raw.recurrence !== 'none'
    ? `確定要刪除私人行程「${raw.title}」整個週期系列嗎？`
    : `確定要刪除私人行程「${raw?.title || ''}」嗎？`;
  if (!window.confirm(message)) return;
  const id = editingPrivateId;
  closePrivateEventModal();
  removePrivateEvent(id);
});
elements.filterScrollLeft?.addEventListener('click', () => scrollFilters(-1));
elements.filterScrollRight?.addEventListener('click', () => scrollFilters(1));
elements.filters.addEventListener('scroll', updateFilterScrollGuide, { passive: true });
window.addEventListener('resize', updateFilterScrollGuide);
document.querySelector('#previousMonth').addEventListener('click', () => changeMonth(-1));
document.querySelector('#nextMonth').addEventListener('click', () => changeMonth(1));
document.querySelector('#refreshButton').addEventListener('click', async () => {
  const button = document.querySelector('#refreshButton');
  const label = button.querySelector('span');
  button.classList.add('is-refreshing');
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (label) label.textContent = '更新中…';
  elements.status.hidden = false;
  elements.status.className = 'status';
  elements.status.textContent = '正在更新資料…';
  let refreshFailed = false;
  try {
    await refreshPublicCalendarData();
    privateLoadedForUid = '';
    await loadPrivateEventsFromFirestore();
  } catch (error) {
    refreshFailed = true;
  }
  button.classList.remove('is-refreshing');
  button.disabled = false;
  button.removeAttribute('aria-busy');
  if (label) label.textContent = '更新資料';
  elements.status.hidden = false;
  if (refreshFailed) {
    elements.status.className = 'status error';
    elements.status.textContent = '更新失敗，已保留畫面中原有資料，請稍後再試。';
  } else {
    elements.status.className = 'status';
    elements.status.textContent = '資料已更新 ✓';
    setTimeout(() => { elements.status.hidden = true; }, 2500);
  }
});
document.querySelector('#selectRegion').addEventListener('click', () => updateRegionSelection(true));
document.querySelector('#clearRegion').addEventListener('click', () => updateRegionSelection(false));
[1, 2].forEach(index => {
  document.querySelector(`#keyword${index}`).addEventListener('input', renderCalendar);
});
document.querySelector('#operator2').addEventListener('change', renderCalendar);
document.querySelector('#clearSearch').addEventListener('click', () => {
  [1, 2].forEach(index => {
    document.querySelector(`#keyword${index}`).value = '';
  });
  document.querySelector('#operator2').value = 'AND';
  renderCalendar();
  document.querySelector('#keyword1').focus();
});
initializeFontLevel();
window.addEventListener('cal-access-changed', handleAccessChanged);
if (window.CAL_ACCESS) handleAccessChanged();
