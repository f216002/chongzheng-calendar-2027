'use strict';

const API_URL = 'https://script.google.com/macros/s/AKfycbx11UqmZ_apamVa7FU5Dp46G9DNddfIeHaohjYFrasLNaZ0QcmDmIl2ZYVmOGihET44/exec';
const CENTER_CLASS_COLOR = '#922626';
const REGIONAL_CLASS_COLOR = '#D65A52';
const CORE_CODES = new Set(['center_classes', 'shared', 'all_classes']);
const TAIWAN_CODES = new Set([
  'center_classes', 'shared', 'all_classes', 'center_routine',
  'jingming', 'dade', 'zhengzong', 'huade', 'north', 'tonghua', 'guangxiong'
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
  categories: [], events: [], selected: new Set(), month: null, activeRegion: 'taiwan'
};
const elements = {
  filters: document.querySelector('#filters'), calendar: document.querySelector('#calendar'),
  status: document.querySelector('#status'), monthLabel: document.querySelector('#monthLabel'),
  yearLabel: document.querySelector('#yearLabel'), regionDescription: document.querySelector('#regionDescription')
};

window.loadCalendarData = function (payload) {
  if (!payload || !payload.success) return showError(payload?.error || '資料格式不正確');
  state.categories = [...payload.categories].map(normalizeCategory).sort((a, b) => a.order - b.order);
  state.events = payload.events.map(normalizeEvent).filter(event => event.date);
  state.selected = new Set(state.categories.filter(item => item.defaultSelected).map(item => item.code));
  const firstDate = state.events.map(item => item.date).sort()[0] || '2027-01-01';
  state.month = firstDate.slice(0, 7);
  renderRegionTabs();
  renderFilters();
  renderCalendar();
};

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

function categoriesForRegion(region = state.activeRegion) {
  const codes = region === 'global' ? GLOBAL_CODES : TAIWAN_CODES;
  return state.categories.filter(category => codes.has(category.code));
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
    label.htmlFor = input.id; label.textContent = category.name;
    wrapper.append(input, label);
    return wrapper;
  }));
}

function isVisible(event) {
  return state.selected.has(event.category) || (state.selected.has('all_classes') && event.isAllClass);
}

function isCoreEvent(event) {
  return event.category === 'center_classes' || event.category === 'shared' ||
    (state.selected.has('all_classes') && event.isAllClass);
}

function renderCalendar() {
  const [year, month] = state.month.split('-').map(Number);
  elements.yearLabel.textContent = `${year} 年`;
  elements.monthLabel.textContent = `${month} 月`;
  const visible = state.events.filter(event => event.date.startsWith(state.month) && isVisible(event));
  const grouped = Map.groupBy ? Map.groupBy(visible, event => event.date) : groupByDate(visible);
  const cards = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([date, events]) => createDateCard(date, events));
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
  const column = document.createElement('section'); column.className = `event-column ${className}`;
  const heading = document.createElement('h3'); heading.className = 'event-column-title'; heading.textContent = title;
  const list = document.createElement('div'); list.className = 'events';
  column.append(heading, list);
  return { column, list };
}

function createEvent(event) {
  const category = state.categories.find(item => item.code === event.category);
  const item = document.createElement('div'); item.className = 'event';
  item.style.setProperty('--event-color', eventDisplayColor(event, category));
  const name = document.createElement('p'); name.className = 'event-name'; name.textContent = event.name;
  const categoryName = document.createElement('p'); categoryName.className = 'event-category';
  categoryName.textContent = conciseEventLabel(event, category);
  item.append(name, categoryName); return item;
}

function conciseEventLabel(event, category) {
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
  renderCalendar();
}

function updateRegionSelection(select) {
  categoriesForRegion().forEach(category => select ? state.selected.add(category.code) : state.selected.delete(category.code));
  renderFilters(); renderCalendar();
}

function resetToDefaultSelection() {
  state.selected = new Set(
    state.categories.filter(category => category.defaultSelected).map(category => category.code)
  );
}

document.querySelectorAll('.region-tab').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.region === state.activeRegion) return;
  state.activeRegion = button.dataset.region;
  resetToDefaultSelection();
  renderRegionTabs(); renderFilters(); renderCalendar();
}));
document.querySelector('#previousMonth').addEventListener('click', () => changeMonth(-1));
document.querySelector('#nextMonth').addEventListener('click', () => changeMonth(1));
document.querySelector('#refreshButton').addEventListener('click', loadData);
document.querySelector('#selectRegion').addEventListener('click', () => updateRegionSelection(true));
document.querySelector('#clearRegion').addEventListener('click', () => updateRegionSelection(false));
document.querySelector('#selectAll').addEventListener('click', () => {
  state.selected = new Set(state.categories.map(item => item.code)); renderFilters(); renderCalendar();
});
document.querySelector('#clearAll').addEventListener('click', () => {
  state.selected.clear(); renderFilters(); renderCalendar();
});
loadData();
