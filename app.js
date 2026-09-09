'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbx11UqmZ_apamVa7FU5Dp46G9DNddfIeHaohjYFrasLNaZ0QcmDmIl2ZYVmOGihET44/exec';
const CENTER_CLASS_COLOR = '#A92B2B';
const REGIONAL_CLASS_COLOR = '#D65A52';
const REGIONAL_CLASS_KEYWORDS = [
  '南部進德班',
  '南部身心靈健康體驗營',
  '北部身心靈健康體驗營',
  '北部進德班'
];
const state = { categories: [], events: [], selected: new Set(), month: null };
const elements = {
  filters: document.querySelector('#filters'), calendar: document.querySelector('#calendar'),
  status: document.querySelector('#status'), monthLabel: document.querySelector('#monthLabel'),
  yearLabel: document.querySelector('#yearLabel')
};

window.loadCalendarData = function (payload) {
  if (!payload || !payload.success) return showError(payload?.error || '資料格式不正確');
  state.categories = [...payload.categories].sort((a, b) => a.order - b.order);
  state.events = payload.events.map(normalizeEvent).filter(event => event.date);
  state.selected = new Set(state.categories.filter(item => item.defaultSelected).map(item => item.code));
  const firstDate = state.events.map(item => item.date).sort()[0] || '2027-01-01';
  state.month = firstDate.slice(0, 7);
  renderFilters();
  renderCalendar();
};

function normalizeEvent(event) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ''))
    ? event.date
    : isoFromTimestamp(event.dateDisplay);
  return { ...event, date, lunar: cleanDisplayDate(event.lunar, true) };
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
  const parts = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(date);
  return lunar ? parts : `${date.getFullYear()}/${parts}`;
}

function loadData() {
  elements.status.hidden = false;
  elements.status.className = 'status';
  elements.status.textContent = '正在讀取最新行事曆…';
  document.querySelector('#calendarApi')?.remove();
  const script = document.createElement('script');
  script.id = 'calendarApi';
  script.src = `${API_URL}?callback=loadCalendarData&t=${Date.now()}`;
  script.onerror = () => showError('目前無法連接行事曆資料，請稍後再試。');
  document.body.appendChild(script);
}

function renderFilters() {
  elements.filters.replaceChildren(...state.categories.map(category => {
    const wrapper = document.createElement('div');
    wrapper.className = 'filter-chip';
    wrapper.style.setProperty('--chip-color', categoryDisplayColor(category));
    const input = document.createElement('input');
    input.type = 'checkbox'; input.id = `filter-${category.code}`; input.value = category.code;
    input.checked = state.selected.has(category.code);
    input.addEventListener('change', () => {
      input.checked ? state.selected.add(category.code) : state.selected.delete(category.code);
      renderCalendar();
    });
    const label = document.createElement('label');
    label.htmlFor = input.id; label.textContent = category.name;
    wrapper.append(input, label);
    return wrapper;
  }));
}

function isVisible(event) {
  return state.selected.has(event.category) || (state.selected.has('all_classes') && event.isAllClass);
}

function renderCalendar() {
  const [year, month] = state.month.split('-').map(Number);
  elements.yearLabel.textContent = `${year} 年`;
  elements.monthLabel.textContent = `${month} 月`;
  const visible = state.events.filter(event => event.date.startsWith(state.month) && isVisible(event));
  const grouped = Map.groupBy ? Map.groupBy(visible, event => event.date) : groupByDate(visible);
  const cards = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, events]) => createDateCard(date, events));
  elements.calendar.replaceChildren(...(cards.length ? cards : [emptyMessage()]));
  elements.status.hidden = true;
}

function groupByDate(events) {
  const map = new Map();
  events.forEach(event => map.set(event.date, [...(map.get(event.date) || []), event]));
  return map;
}

function createDateCard(date, events) {
  const card = document.createElement('article'); card.className = 'date-card';
  const meta = document.createElement('div'); meta.className = 'date-meta';
  const time = document.createElement('time'); time.dateTime = date; time.textContent = date.replaceAll('-', '/');
  const weekday = document.createElement('span'); weekday.className = 'weekday'; weekday.textContent = events[0].weekday || '';
  const lunar = document.createElement('div'); lunar.className = 'lunar'; lunar.textContent = `農曆 ${events[0].lunar || '—'}`;
  const week = document.createElement('div'); week.className = 'week'; week.textContent = events[0].week || '';
  meta.append(time, weekday, lunar, week);
  const list = document.createElement('div'); list.className = 'events';
  events.sort((a, b) => a.order - b.order).forEach(event => list.append(createEvent(event)));
  card.append(meta, list); return card;
}

function createEvent(event) {
  const category = state.categories.find(item => item.code === event.category);
  const item = document.createElement('div'); item.className = 'event';
  item.style.setProperty('--event-color', eventDisplayColor(event, category));
  const name = document.createElement('p'); name.className = 'event-name'; name.textContent = event.name;
  const categoryName = document.createElement('p'); categoryName.className = 'event-category';
  categoryName.textContent = `${event.categoryName}${event.venue ? ` · ${event.venue}` : ''}`;
  item.append(name, categoryName); return item;
}

function categoryDisplayColor(category) {
  return category?.code === 'center_classes'
    ? CENTER_CLASS_COLOR
    : (category?.color || '#315e78');
}

function eventDisplayColor(event, category) {
  if (event.category === 'center_classes') return CENTER_CLASS_COLOR;
  if (REGIONAL_CLASS_KEYWORDS.some(keyword => String(event.name || '').includes(keyword))) {
    return REGIONAL_CLASS_COLOR;
  }
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
  renderCalendar();
}

function showError(message) {
  elements.status.hidden = false; elements.status.className = 'status error';
  elements.status.textContent = message;
}

document.querySelector('#previousMonth').addEventListener('click', () => changeMonth(-1));
document.querySelector('#nextMonth').addEventListener('click', () => changeMonth(1));
document.querySelector('#refreshButton').addEventListener('click', loadData);
document.querySelector('#selectAll').addEventListener('click', () => {
  state.selected = new Set(state.categories.map(item => item.code)); renderFilters(); renderCalendar();
});
document.querySelector('#clearAll').addEventListener('click', () => {
  state.selected.clear(); renderFilters(); renderCalendar();
});
loadData();
