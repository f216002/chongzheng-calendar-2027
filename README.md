# 寶光崇正 2027 年度整合行事曆

這是純靜態前端，資料即時讀取 Google Apps Script Web App API，適合直接使用 GitHub Pages。

## 資料流程

1. 在 Google Sheet 的原始年度總表修改活動。
2. 在 Apps Script 執行 `一鍵建立網頁資料`。
3. 網頁重新整理後即讀取最新資料，不需要重新上傳前端程式。

## GitHub Pages

儲存庫的 Pages 來源請設定為 `Deploy from a branch`，Branch 選 `main`，資料夾選 `/ (root)`。

## API

API 網址設定於 `app.js` 最上方的 `API_URL`。目前使用 Apps Script JSONP，避免 GitHub Pages 跨網域讀取限制。

## Apps Script 日期修正

若 API 的 `dateDisplay` 或 `lunar` 顯示為 `2026-10-01T16:00:00.000Z`，請更新至資料建置程式 v1.2、重新執行資料建置，並將 Web App 建立「New version」後重新部署。前端已加入相容性防護，但資料層仍建議完成修正。
