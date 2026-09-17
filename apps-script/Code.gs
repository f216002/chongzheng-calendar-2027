/**
 * 寶光崇正整合行事曆：Google Sheet、網頁 API 與 Google Calendar 同步（v1.4.2）
 *
 * 使用位置：目標 Google 試算表的「擴充功能 → Apps Script」
 * 資料來源：保留原本 A:Q 欄的年度總表，不修改來源資料。
 * 產生內容：網頁活動資料、分類設定、系統設定。
 */

const 行事曆設定 = Object.freeze({
  來源工作表優先名稱: '2027年度_月曆報表',
  活動資料表: '網頁活動資料',
  分類設定表: '分類設定',
  系統設定表: '系統設定',
  Google同步索引表: 'Google日曆同步索引',
  Google同步批次筆數: 60,
  時區: 'Asia/Taipei',
  API版本: '1.4.2'
});

const Google同步屬性 = Object.freeze({
  公版日曆ID: 'google_public_calendar_id',
  試算表ID: 'google_calendar_sync_spreadsheet_id',
  游標: 'google_calendar_sync_cursor',
  總筆數: 'google_calendar_sync_total',
  重試輪次: 'google_calendar_sync_retry_round',
  最近狀態: 'google_calendar_sync_status'
});

const 欄位分類 = Object.freeze([
  { 欄: 'E', 代碼: 'center_routine', 名稱: '道務中心人事課／月懺／活動', 道場: '道務中心', 顏色: '#315E78', 預設: false, 排序: 40 },
  { 欄: 'F', 代碼: 'center_classes', 名稱: '道務中心仙佛班', 道場: '道務中心', 顏色: '#C6413A', 預設: true, 排序: 10 },
  { 欄: 'G', 代碼: 'shared', 名稱: '仙佛聖誕／節日活動／開會', 道場: '共同', 顏色: '#A9681D', 預設: true, 排序: 20 },
  { 欄: 'H', 代碼: 'jingming', 名稱: '精明課程與活動', 道場: '精明', 顏色: '#16806C', 預設: false, 排序: 50 },
  { 欄: 'I', 代碼: 'dade', 名稱: '大德課程與活動', 道場: '大德', 顏色: '#4870A8', 預設: false, 排序: 60 },
  { 欄: 'J', 代碼: 'zhengzong', 名稱: '正宗課程與活動', 道場: '正宗', 顏色: '#7B5A9B', 預設: false, 排序: 70 },
  { 欄: 'K', 代碼: 'huade', 名稱: '華德課程與活動', 道場: '華德', 顏色: '#B25D71', 預設: false, 排序: 80 },
  { 欄: 'L', 代碼: 'north', 名稱: '北部課程與活動', 道場: '北部', 顏色: '#397F9B', 預設: false, 排序: 90 },
  { 欄: 'M', 代碼: 'tonghua', 名稱: '通化課程與活動', 道場: '通化', 顏色: '#7C7433', 預設: false, 排序: 100 },
  { 欄: 'N', 代碼: 'guangxiong', 名稱: '光雄課程與活動', 道場: '光雄', 顏色: '#9A5E38', 預設: false, 排序: 110 },
  { 欄: 'O', 代碼: 'indonesia', 名稱: '印尼課程與活動', 道場: '印尼', 顏色: '#3D7EA6', 預設: false, 排序: 120 },
  { 欄: 'P', 代碼: 'malaysia_group', 名稱: '馬來西亞／印尼棉蘭／孟加拉課程與活動', 道場: '馬來西亞／印尼棉蘭／孟加拉', 顏色: '#2F806D', 預設: false, 排序: 130 },
  { 欄: 'Q', 代碼: 'cambodia', 名稱: '柬埔寨課程與活動', 道場: '柬埔寨', 顏色: '#8B5E9F', 預設: false, 排序: 140 }
]);

const 全部仙佛班關鍵字 = Object.freeze([
  '南部進德',
  '南部身心靈健康體驗營',
  '北部身心靈健康體驗營',
  '北部進德班'
]);

/** 開啟試算表時建立專用選單。 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('寶光行事曆工具')
    .addItem('一鍵更新網頁＋Google公版日曆', '一鍵更新全部資料')
    .addItem('僅建立／更新網頁資料', '一鍵建立網頁資料')
    .addItem('設定Google公版日曆ID', '設定Google公版日曆ID')
    .addItem('繼續Google日曆同步', '繼續Google日曆同步')
    .addSeparator()
    .addItem('查看資料統計', '查看資料統計')
    .addItem('查看Google日曆同步狀態', '查看Google日曆同步狀態')
    .addToUi();
}

/** 將私人日曆 ID 儲存在 Script Properties，不寫入公開原始碼或工作表。 */
function 設定Google公版日曆ID() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    '設定 Google 公版日曆 ID',
    '請貼上「寶光崇正2027年度全球行事曆」的日曆 ID：',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const calendarId = response.getResponseText().trim();
  if (!calendarId || !calendarId.includes('@')) {
    ui.alert('日曆 ID 格式不正確，請從 Google 日曆「設定和共用 → 整合日曆」重新複製。');
    return;
  }
  const calendar = CalendarApp.getCalendarById(calendarId);
  if (!calendar) {
    ui.alert('目前帳號找不到這個日曆，請確認 ID 與修改權限。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(Google同步屬性.公版日曆ID, calendarId);
  ui.alert('Google 公版日曆已設定完成：' + calendar.getName());
}

/**
 * 日常維護入口：先重建網頁資料，再以分批差異同步更新 Google 公版日曆。
 * 第一次執行會要求 Google 日曆權限；後續只處理新增、修改及刪除的活動。
 */
function 一鍵更新全部資料() {
  const result = 一鍵建立網頁資料();
  啟動Google日曆同步();
  return result;
}

/**
 * 主程式：從 A:Q 年度總表重建三張系統資料表。
 * 可重複執行；不會修改原始年度總表。
 */
function 一鍵建立網頁資料() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.setSpreadsheetTimeZone(行事曆設定.時區);
    ss.toast('正在讀取年度總表…', '寶光行事曆', 5);

    const source = 尋找來源工作表_(ss);
    const events = 轉換總表為活動資料_(source);

    寫入分類設定_(ss);
    寫入活動資料_(ss, events);
    寫入系統設定_(ss, source, events.length);

    CacheService.getScriptCache().removeAll(['calendar_api_v1', 'calendar_api_v2']);
    SpreadsheetApp.flush();

    // 只使用不會暫停程式的通知。
    // 不可在這裡使用 SpreadsheetApp.getUi().alert()：
    // 從 Apps Script 編輯器執行時，alert 會在試算表分頁等待使用者回覆，
    // 導致程式看似一直運轉，最後超過六分鐘限制。
    const message = '完成：已建立 ' + events.length + ' 筆網頁活動資料。';
    ss.toast(message, '寶光行事曆', 8);
    console.log(message + ' 來源工作表：' + source.getName());
    return {
      success: true,
      sourceSheet: source.getName(),
      eventCount: events.length
    };
  } catch (error) {
    SpreadsheetApp.getActiveSpreadsheet().toast(
      '建立失敗：' + error.message,
      '寶光行事曆',
      10
    );
    console.error(error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** 寻找包含日期、F栏仙佛班等表头的来源工作表。 */
function 尋找來源工作表_(ss) {
  const preferred = ss.getSheetByName(行事曆設定.來源工作表優先名稱);
  if (preferred && 是年度總表_(preferred)) return preferred;

  const excluded = new Set([
    行事曆設定.活動資料表,
    行事曆設定.分類設定表,
    行事曆設定.系統設定表,
    行事曆設定.Google同步索引表
  ]);

  const found = ss.getSheets().find(sheet => !excluded.has(sheet.getName()) && 是年度總表_(sheet));
  if (!found) {
    throw new Error('找不到年度總表。請確認來源工作表的A1是「日期」，而且至少有A:Q欄。');
  }
  return found;
}

function 是年度總表_(sheet) {
  if (sheet.getLastColumn() < 17 || sheet.getLastRow() < 2) return false;
  const headers = sheet.getRange(1, 1, 1, 17).getDisplayValues()[0];
  return String(headers[0]).trim() === '日期' && String(headers[5]).includes('仙佛班');
}

/** 将宽表转换成一项活动一列的标准资料。 */
function 轉換總表為活動資料_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const raw = sheet.getRange(2, 1, lastRow - 1, 17).getValues();
  const display = sheet.getRange(2, 1, lastRow - 1, 17).getDisplayValues();
  const results = [];

  raw.forEach((row, rowIndex) => {
    const sourceRow = rowIndex + 2;
    const isoDate = 日期轉ISO_(row[0], display[rowIndex][0]);
    if (!isoDate) return;

    欄位分類.forEach(category => {
      const colIndex = 欄字母轉索引_(category.欄);
      const cellText = display[rowIndex][colIndex];
      const eventLines = 拆分活動_(cellText);

      eventLines.forEach((eventName, lineIndex) => {
        const isAllClass = category.代碼 === 'center_classes' ||
          全部仙佛班關鍵字.some(keyword => eventName.includes(keyword));

        results.push([
          建立活動ID_(isoDate, category.代碼, lineIndex + 1),
          new Date(isoDate + 'T12:00:00'),
          display[rowIndex][0],
          display[rowIndex][1],
          display[rowIndex][2],
          display[rowIndex][3],
          category.代碼,
          category.名稱,
          category.道場,
          eventName,
          isAllClass,
          sheet.getName(),
          sourceRow,
          category.欄,
          category.排序 * 100 + lineIndex + 1,
          true
        ]);
      });
    });
  });

  return results;
}

function 拆分活動_(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .split(/\n|[\t ]{2,}/)
    .map(text => text.trim())
    .filter(Boolean);
}

function 日期轉ISO_(rawValue, displayValue) {
  if (rawValue instanceof Date && !isNaN(rawValue)) {
    return Utilities.formatDate(rawValue, 行事曆設定.時區, 'yyyy-MM-dd');
  }

  const text = String(displayValue || rawValue || '').trim();
  let match = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (match) return match[1] + '-' + 補零_(match[2]) + '-' + 補零_(match[3]);

  match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return match[3] + '-' + 補零_(match[1]) + '-' + 補零_(match[2]);

  return '';
}

function 建立活動ID_(isoDate, categoryCode, sequence) {
  return 'EVT-' + isoDate.replace(/-/g, '') + '-' + categoryCode + '-' + String(sequence).padStart(2, '0');
}

function 寫入活動資料_(ss, rows) {
  const headers = [[
    'event_id', 'event_date', 'solar_date_display', 'week_no', 'weekday', 'lunar_date',
    'category_code', 'category_name', 'venue', 'event_name', 'is_all_class',
    'source_sheet', 'source_row', 'source_column', 'sort_order', 'enabled'
  ]];
  const sheet = 取得或建立工作表_(ss, 行事曆設定.活動資料表);
  清除工作表_(sheet);
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  if (rows.length) {
    // 顯示日期與農曆必須保持文字，避免 Google Sheets 自動轉成日期及 UTC 時間戳。
    sheet.getRange(2, 3, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 6, rows.length, 1).setNumberFormat('@');
    sheet.getRange(2, 1, rows.length, headers[0].length).setValues(rows);
  }

  格式化表頭_(sheet, headers[0].length, '#183A56');
  sheet.setFrozenRows(1);
  sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd');
  if (rows.length) {
    sheet.getRange(2, 11, rows.length, 1).insertCheckboxes();
    sheet.getRange(2, 16, rows.length, 1).insertCheckboxes();
  }
  sheet.setColumnWidth(1, 245);
  sheet.setColumnWidth(2, 105);
  sheet.setColumnWidth(6, 90);
  sheet.setColumnWidth(8, 210);
  sheet.setColumnWidth(10, 430);
  sheet.setColumnWidth(12, 180);
  sheet.getDataRange().setVerticalAlignment('top');
  if (rows.length) sheet.getRange(1, 1, rows.length + 1, headers[0].length).createFilter();
}

function 寫入分類設定_(ss) {
  const headers = [['category_code', 'display_name', 'source_column', 'venue', 'color', 'default_selected', 'sort_order', 'is_virtual', 'notes']];
  const rows = [
    ...欄位分類.map(c => [c.代碼, c.名稱, c.欄, c.道場, c.顏色, c.預設, c.排序, false, '']),
    ['all_classes', '全部仙佛班', '', '跨分类', '#713F9A', false, 30, true,
      '包含F栏全部活动，以及名称含南部进德、南部身心灵健康体验营、北部身心灵健康体验营、北部进德班的活动。']
  ].sort((a, b) => a[6] - b[6]);

  const sheet = 取得或建立工作表_(ss, 行事曆設定.分類設定表);
  清除工作表_(sheet);
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  sheet.getRange(2, 1, rows.length, headers[0].length).setValues(rows);
  格式化表頭_(sheet, headers[0].length, '#8A6422');
  sheet.setFrozenRows(1);
  sheet.getRange(2, 6, rows.length, 1).insertCheckboxes();
  sheet.getRange(2, 8, rows.length, 1).insertCheckboxes();
  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(9, 520);
}

function 寫入系統設定_(ss, source, eventCount) {
  const rows = [
    ['setting_key', 'setting_value', 'description'],
    ['calendar_title', '寶光崇正2027年度全球行事曆', '前端網站顯示名稱'],
    ['source_sheet', source.getName(), 'A:Q原始年度總表；程式不會修改此表'],
    ['events_sheet', 行事曆設定.活動資料表, '網頁讀取的標準化活動資料'],
    ['categories_sheet', 行事曆設定.分類設定表, '篩選名稱、顏色、預設狀態與順序'],
    ['timezone', 行事曆設定.時區, '日期與時間使用的時區'],
    ['google_calendar_sync', PropertiesService.getScriptProperties().getProperty(Google同步屬性.公版日曆ID) ? '已設定' : '未設定', 'Google公版日曆ID僅存於Script Properties'],
    ['api_version', 行事曆設定.API版本, 'Apps Script API版本'],
    ['event_count', eventCount, '最近一次產生的活動筆數'],
    ['last_updated', new Date(), '最近一次執行一鍵更新的時間']
  ];
  const sheet = 取得或建立工作表_(ss, 行事曆設定.系統設定表);
  清除工作表_(sheet);
  sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  格式化表頭_(sheet, rows[0].length, '#315E78');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 310);
  sheet.setColumnWidth(3, 450);
  sheet.getRange('B:B').setWrap(true);
  sheet.getRange(rows.length, 2).setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function 查看資料統計() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(行事曆設定.活動資料表);
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('尚未建立網頁活動資料，請先執行「一鍵建立／更新網頁資料」。');
    return;
  }
  const count = sheet.getLastRow() - 1;
  const allClassCount = sheet.getRange(2, 11, count, 1).getValues().filter(r => r[0] === true).length;
  SpreadsheetApp.getUi().alert('活動資料共 ' + count + ' 筆\n其中「全部仙佛班」共有 ' + allClassCount + ' 筆。');
}

/** 從第一筆開始新的 Google 公版日曆差異同步。 */
function 啟動Google日曆同步() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const events = 讀取Google同步活動_(ss);
  const properties = PropertiesService.getScriptProperties();

  清除Google同步觸發器_();
  properties.setProperties({
    [Google同步屬性.試算表ID]: ss.getId(),
    [Google同步屬性.游標]: '0',
    [Google同步屬性.總筆數]: String(events.length),
    [Google同步屬性.重試輪次]: '0',
    [Google同步屬性.最近狀態]: '準備同步 0／' + events.length
  });

  ss.toast('已啟動 Google 公版日曆同步，共 ' + events.length + ' 筆。', '寶光行事曆', 6);
  繼續Google日曆同步();
}

/**
 * 每次只處理固定筆數；若尚未完成，建立一個一分鐘後繼續的單次觸發器。
 * 這能避免首次匯入大量活動時超過 Apps Script 單次執行時間。
 */
function 繼續Google日曆同步() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;

  try {
    const ss = 取得Google同步試算表_();
    const calendar = CalendarApp.getCalendarById(取得Google公版日曆ID_());
    if (!calendar) throw new Error('找不到 Google 公版日曆，請檢查行事曆 ID 或帳號權限。');

    const events = 讀取Google同步活動_(ss);
    const index = 讀取Google同步索引_(ss);
    const properties = PropertiesService.getScriptProperties();
    const start = Math.max(0, Number(properties.getProperty(Google同步屬性.游標)) || 0);
    let end = start;
    let attemptedWrites = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (let i = start; i < events.length; i += 1) {
      const item = events[i];
      end = i + 1;
      try {
        const existing = index.get(item.id);
        if (existing && existing.fingerprint === item.fingerprint) {
          skipped += 1;
          continue;
        }

        attemptedWrites += 1;

        let calendarEvent = existing && existing.calendarEventId
          ? calendar.getEventById(existing.calendarEventId)
          : null;

        if (calendarEvent) {
          calendarEvent
            .setTitle(item.title)
            .setDescription(item.description)
            .setAllDayDate(item.date);
          updated += 1;
        } else {
          calendarEvent = calendar.createAllDayEvent(item.title, item.date, {
            description: item.description
          });
          created += 1;
        }

        index.set(item.id, {
          eventId: item.id,
          calendarEventId: calendarEvent.getId(),
          fingerprint: item.fingerprint,
          lastSynced: new Date()
        });
      } catch (error) {
        errors.push(item.id + '：' + error.message);
      }

      if (attemptedWrites >= 行事曆設定.Google同步批次筆數) break;
    }

    寫入Google同步索引_(ss, index);
    properties.setProperty(Google同步屬性.游標, String(end));
    properties.setProperty(Google同步屬性.總筆數, String(events.length));

    const progress = '同步進度 ' + end + '／' + events.length +
      '（新增 ' + created + '、更新 ' + updated + '、略過 ' + skipped +
      (errors.length ? '、錯誤 ' + errors.length : '') + '）';
    properties.setProperty(Google同步屬性.最近狀態, progress);
    ss.toast(progress, '寶光行事曆', 8);
    if (errors.length) console.error(errors.join('\n'));

    if (end < events.length) {
      安排下一批Google同步_();
      return;
    }

    const currentIds = new Set(events.map(item => item.id));
    const deleted = 刪除Google日曆舊活動_(calendar, index, currentIds);
    寫入Google同步索引_(ss, index);
    const successful = events.filter(item => index.has(item.id)).length;
    const missing = events.length - successful;

    if (missing > 0) {
      const retryRound = (Number(properties.getProperty(Google同步屬性.重試輪次)) || 0) + 1;
      properties.setProperty(Google同步屬性.重試輪次, String(retryRound));
      properties.setProperty(Google同步屬性.游標, '0');

      const willRetry = retryRound <= 3;
      const incompleteStatus = '同步尚未完整：成功 ' + successful + '／' + events.length +
        '，尚缺 ' + missing + ' 筆。' +
        (willRetry ? '已安排第 ' + retryRound + ' 次自動重試。' : '請稍後手動繼續同步。');
      properties.setProperty(Google同步屬性.最近狀態, incompleteStatus);
      ss.toast(incompleteStatus, '寶光行事曆', 10);
      if (willRetry) 安排下一批Google同步_(5 * 60 * 1000);
      return;
    }

    properties.deleteProperty(Google同步屬性.游標);
    properties.deleteProperty(Google同步屬性.重試輪次);
    properties.setProperty(
      Google同步屬性.最近狀態,
      '同步完成：' + events.length + ' 筆活動，清除 ' + deleted + ' 筆舊活動。'
    );
    清除Google同步觸發器_();
    ss.toast('Google 公版日曆同步完成，共 ' + events.length + ' 筆。', '寶光行事曆', 10);
  } catch (error) {
    PropertiesService.getScriptProperties().setProperty(
      Google同步屬性.最近狀態,
      '同步失敗：' + error.message
    );
    SpreadsheetApp.getActiveSpreadsheet().toast('同步失敗：' + error.message, '寶光行事曆', 10);
    console.error(error);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function 查看Google日曆同步狀態() {
  const status = PropertiesService.getScriptProperties()
    .getProperty(Google同步屬性.最近狀態) || '尚未執行 Google 公版日曆同步。';
  SpreadsheetApp.getUi().alert(status);
}

function 取得Google公版日曆ID_() {
  const calendarId = PropertiesService.getScriptProperties()
    .getProperty(Google同步屬性.公版日曆ID);
  if (!calendarId) {
    throw new Error('尚未設定 Google 公版日曆 ID，請先從試算表選單執行「設定Google公版日曆ID」。');
  }
  return calendarId;
}

function 取得Google同步試算表_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(Google同步屬性.試算表ID);
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('找不到同步來源試算表，請從試算表選單重新啟動同步。');
  properties.setProperty(Google同步屬性.試算表ID, active.getId());
  return active;
}

function 讀取Google同步活動_(ss) {
  const sheet = ss.getSheetByName(行事曆設定.活動資料表);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('尚未建立網頁活動資料，請先執行「一鍵建立／更新網頁資料」。');
  }

  const range = sheet.getDataRange();
  const rawRows = 資料列轉物件_(range.getValues());
  const displayRows = 資料列轉物件_(range.getDisplayValues());

  return rawRows
    .map((raw, index) => ({ raw: raw, display: displayRows[index] || raw }))
    .filter(record => record.raw.enabled === true)
    .map(record => {
      const raw = record.raw;
      const display = record.display;
      const isoDate = Utilities.formatDate(new Date(raw.event_date), 行事曆設定.時區, 'yyyy-MM-dd');
      const title = String(display.event_name || '').trim();
      const description = [
        '分類：' + String(display.category_name || ''),
        '單位：' + String(display.venue || ''),
        '來源：寶光崇正2027年度全球行事曆',
        '同步識別碼：' + String(display.event_id || '')
      ].join('\n');
      const fingerprint = 建立Google同步指紋_([
        isoDate,
        title,
        display.category_code,
        display.category_name,
        display.venue
      ].join('|'));

      return {
        id: String(display.event_id || ''),
        title: title,
        date: 建立本地日期_(isoDate),
        description: description,
        fingerprint: fingerprint,
        order: Number(raw.sort_order) || 9999
      };
    })
    .filter(item => item.id && item.title)
    .sort((a, b) => a.date - b.date || a.order - b.order || a.id.localeCompare(b.id));
}

function 讀取Google同步索引_(ss) {
  const sheet = ss.getSheetByName(行事曆設定.Google同步索引表);
  const index = new Map();
  if (!sheet || sheet.getLastRow() < 2) return index;

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  rows.forEach(row => {
    const eventId = String(row[0] || '');
    if (!eventId) return;
    index.set(eventId, {
      eventId: eventId,
      calendarEventId: String(row[1] || ''),
      fingerprint: String(row[2] || ''),
      lastSynced: row[3] || ''
    });
  });
  return index;
}

function 寫入Google同步索引_(ss, index) {
  const sheet = 取得或建立工作表_(ss, 行事曆設定.Google同步索引表);
  清除工作表_(sheet);
  const headers = [['event_id', 'google_calendar_event_id', 'fingerprint', 'last_synced']];
  const rows = Array.from(index.values())
    .sort((a, b) => a.eventId.localeCompare(b.eventId))
    .map(item => [item.eventId, item.calendarEventId, item.fingerprint, item.lastSynced]);
  sheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers[0].length).setValues(rows);
  格式化表頭_(sheet, headers[0].length, '#8A6422');
  sheet.setFrozenRows(1);
  sheet.hideSheet();
}

function 刪除Google日曆舊活動_(calendar, index, currentIds) {
  let deleted = 0;
  Array.from(index.entries()).forEach(entry => {
    const eventId = entry[0];
    const item = entry[1];
    if (currentIds.has(eventId)) return;
    try {
      const calendarEvent = item.calendarEventId
        ? calendar.getEventById(item.calendarEventId)
        : null;
      if (calendarEvent) calendarEvent.deleteEvent();
      index.delete(eventId);
      deleted += 1;
    } catch (error) {
      console.error('無法刪除舊活動 ' + eventId + '：' + error.message);
    }
  });
  return deleted;
}

function 安排下一批Google同步_(delayMs) {
  清除Google同步觸發器_();
  ScriptApp.newTrigger('繼續Google日曆同步')
    .timeBased()
    .after(delayMs || 60 * 1000)
    .create();
}

function 清除Google同步觸發器_() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === '繼續Google日曆同步')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
}

function 建立Google同步指紋_(text) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  ).map(byte => ('0' + (byte & 255).toString(16)).slice(-2)).join('');
}

function 建立本地日期_(isoDate) {
  const parts = String(isoDate).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

/**
 * 发布为Web App后的API入口。
 * GitHub Pages建议使用：WEB_APP_URL?callback=loadCalendarData
 */
function doGet(e) {
  try {
    const callback = e && e.parameter ? String(e.parameter.callback || '') : '';
    const payload = 取得網頁API資料_();
    const json = JSON.stringify(payload);

    if (callback) {
      if (!/^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)) {
        return ContentService.createTextOutput('/* invalid callback */')
          .setMimeType(ContentService.MimeType.JAVASCRIPT);
      }
      return ContentService.createTextOutput(callback + '(' + json + ');')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function 取得網頁API資料_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('calendar_api_v2');
  if (cached) return JSON.parse(cached);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const eventSheet = ss.getSheetByName(行事曆設定.活動資料表);
  const categorySheet = ss.getSheetByName(行事曆設定.分類設定表);
  if (!eventSheet || !categorySheet) throw new Error('請先執行「一鍵建立／更新網頁資料」。');

  const eventRange = eventSheet.getDataRange();
  const eventValues = eventRange.getValues();
  const eventDisplayValues = eventRange.getDisplayValues();
  const categoryValues = categorySheet.getDataRange().getValues();
  const rawEvents = 資料列轉物件_(eventValues);
  const displayEvents = 資料列轉物件_(eventDisplayValues);
  const events = rawEvents
    .map((item, index) => ({ item: item, display: displayEvents[index] || item }))
    .filter(record => record.item.enabled === true)
    .map(record => ({
      id: record.display.event_id,
      date: Utilities.formatDate(new Date(record.item.event_date), 行事曆設定.時區, 'yyyy-MM-dd'),
      dateDisplay: record.display.solar_date_display,
      week: record.display.week_no,
      weekday: record.display.weekday,
      lunar: record.display.lunar_date,
      category: record.display.category_code,
      categoryName: record.display.category_name,
      venue: record.display.venue,
      name: record.display.event_name,
      isAllClass: record.item.is_all_class === true,
      order: Number(record.item.sort_order) || 9999
    }));

  const categories = 資料列轉物件_(categoryValues)
    .map(item => ({
      code: item.category_code,
      name: item.display_name,
      sourceColumn: item.source_column,
      venue: item.venue,
      color: item.color,
      defaultSelected: item.default_selected === true,
      order: Number(item.sort_order) || 9999,
      virtual: item.is_virtual === true
    }))
    .sort((a, b) => a.order - b.order);

  const payload = {
    success: true,
    apiVersion: 行事曆設定.API版本,
    generatedAt: Utilities.formatDate(new Date(), 行事曆設定.時區, "yyyy-MM-dd'T'HH:mm:ssXXX"),
    categories: categories,
    events: events
  };

  const serialized = JSON.stringify(payload);
  if (serialized.length < 95000) cache.put('calendar_api_v2', serialized, 300);
  return payload;
}

function 資料列轉物件_(values) {
  if (!values.length) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(value => value !== '')).map(row => {
    const object = {};
    headers.forEach((header, index) => object[header] = row[index]);
    return object;
  });
}

function 取得或建立工作表_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function 清除工作表_(sheet) {
  const filter = sheet.getFilter();
  if (filter) filter.remove();
  sheet.clear();
  sheet.clearConditionalFormatRules();
}

function 格式化表頭_(sheet, columnCount, color) {
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground(color)
    .setFontColor('#FFFFFF')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
  sheet.setRowHeight(1, 34);
}

function 欄字母轉索引_(letter) {
  return letter.charCodeAt(0) - 65;
}

function 補零_(value) {
  return String(value).padStart(2, '0');
}
