# Scope 3 GitHub App — ESG Manager 工作台補強

## 1. 目的與背景

目前 Worker 只有三個給人用的畫面（供應商填表頁、Manager 管理頁、Manager 儀表板），最大的斷層是**盤查／審核完全在 GitHub PR 上做**，Manager 必須會用 GitHub 才能核定提交。報表只在 GitHub Release、佐證檔沒有檢視介面、管理頁缺導覽與登出。

本案把 Manager 需要的能力補成**一個多頁工作台**：在網頁上完成審核→核定／退件、供應商被退件能在填表頁原地修改重送、線上看與下載報表，全程不必碰 GitHub。

**前提**：盤查員＝ESG Manager 本人（已與使用者確認）。系統的「人」只有兩種角色：**Manager**（GitHub OAuth 登入）與**供應商**（憑 token，無 GitHub 帳號）。

## 2. 核心決策（已與使用者確認）

- 盤查員就是 Manager 本人 → 要在 Worker 內做審核介面。
- 範圍＝一次補到可營運：審核中心＋供應商退件閉環＋報表＋管理頁完善（導覽／登出／年份）。
- 退件後供應商**原地編輯重送**（預填原內容、更新同一 PR 重審），不是撤回重填。
- 報表由 **Worker 即時產生**（讀最新 `data/submissions.json`，重用 report-lib 純函式）。
- 介面骨架＝**多頁＋共用導覽列**。

## 3. 整體架構

四個頁面，全部 session 保護、共用 App installation token，頂部共用導覽列：

| 頁面 | 路由 | 內容 |
|------|------|------|
| 設定 | `/admin/:org` | 盤點年度／類別、供應商 CRUD（現有） |
| 審核 | `/admin/:org/review` | 待審清單、單筆詳情、核定／退件（新增） |
| 儀表板 | `/dashboard/:org` | KPI（現有，加年份篩選） |
| 報表 | `/admin/:org/reports` | GHG 總覽＋下載 CSV（新增） |

導覽列為 `src/ui/theme.mjs` 的 `renderNav(org, active)` 函式，輸出 `設定 ｜ 審核(n) ｜ 儀表板 ｜ 報表 ⋯ 登出`；各頁 HTML 引用，`active` 標示當前頁，`n` 為待審筆數。

**核定的把關語意**：「核定＝merge PR」原本在 GitHub 人工做。Manager 在審核中心按「核定」時，Worker 用 App token 代為 merge 該 PR——仍是**人按按鈕**，把關沒有減少，只是介面從 GitHub 搬進 Worker。這與原 branch/PR spec 的「不做自動 merge」不衝突（自動 merge 指無人把關）。

## 4. 五個區塊（可獨立交付）

### 區塊 1 — 導覽骨架＋登出
- `theme.mjs` 新增 `renderNav(org, active, pendingCount)`。
- `/admin/:org`、`/dashboard/:org` 套用導覽列；新增登出按鈕（端點 `POST /admin/:org/logout` 已存在，補 UI）。
- 「審核」分頁旁顯示待審筆數 badge（來自 open PR 數）。

### 區塊 2 — 審核中心 `/admin/:org/review`
- **待審清單**：`listOpenPullRequestsByPrefix(octokit, org, 'sub/')`（已有）列出 open PR；每筆顯示供應商／類別／期間／活動／數量，以及 **validate 狀態燈**。
  - validate 狀態：查該 PR head commit 的 check runs（`GET /repos/{owner}/{repo}/commits/{ref}/check-runs`），取 conclusion（success→綠、failure→紅、無→灰）。
- **單筆詳情**：讀該 PR 分支的提交 JSON（`pr.ts` 新增 `getFileOnBranch`）→ 顯示完整欄位；佐證檔以 `evidence_urls` 連到 `/files/*`（已有）；顯示 validate 結果摘要。
- **核定**：`POST /api/v1/admin/:org/review/:pr/approve` → `pr.ts` 新增 `mergePullRequest`（`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`）→ merge 觸發租戶 repo 的 `calculate`（on push main）自動算進儀表板。validate 紅燈時前端核定鈕需二次確認（把關在人）。
- **退件**：`POST /api/v1/admin/:org/review/:pr/reject`（body: `reason`）→ `pr.ts` 新增 `addLabelToPR` 加 `status:revision`（此 label 已存在於 repo）＋ `commentOnPR` 留言 `退件理由：<reason>`。PR 保持 open。
- audit_log 記錄 `submission_approved` / `submission_rejected`。

### 區塊 3 — 供應商退件閉環（填表頁）
- 填表頁「我的提交紀錄」：對每個 open PR 查 label。
  - 有 `status:revision` → 狀態顯示「需修改」，並列出最新退件留言理由（`pr.ts` 新增 `getLatestRejectReason`：讀 PR 留言找最後一則 `退件理由：` 開頭）。
  - 否則維持「審核中」。
- **原地編輯**：
  - `GET /submit/:org/:token/edit/:submissionId` → 讀該 PR 分支 JSON（`getFileOnBranch`）→ 回傳預填的編輯表單（重用填表表單，帶入原值與 `submissionId`）。
  - `POST /submit/:org/:token/edit/:submissionId` → `pr.ts` 新增 `updateFileOnBranch`（`PUT contents` 帶 `sha`＋`branch`）更新分支 JSON → PR 自動 synchronize → validate 重跑；同時移除 `status:revision` label（`pr.ts` 新增 `removeLabelFromPR`），讓該筆重回「審核中」。
- 取代 Plan B 當時以「撤回重填」暫代的編輯方案；既有撤回功能保留。

### 區塊 4 — 報表 `/admin/:org/reports`
- 將 report-lib 純函式移植進 Worker：`src/lib/report.ts` 匯出 `toCsv(submissions)` 與 `toGhgMarkdown(submissions, year)`（邏輯同 `tenant-template/scripts/report-lib.mjs`，改寫為 TS；CSV 欄位含 `source_file`）。
- 頁面：年份下拉 → 顯示該年 GHG 總覽（總排放、各類別）＋「下載 CSV」按鈕。
- API：`GET /api/v1/admin/:org/report?year=<yyyy>&format=csv|md`
  - 讀 `data/submissions.json`（重用 `readAggregatedSubmissions`），依 `year` 過濾，呼叫 `toCsv`／`toGhgMarkdown` 即時產生。
  - `format=csv` 回 `text/csv` 附 `Content-Disposition: attachment`；`format=md` 回 `text/markdown`。

### 區塊 5 — 年份篩選
- 年份取自 `submission.period` 前 4 碼（如 `2025-Q2` → `2025`）。
- `GET /api/v1/admin/:org/dashboard-data?year=<yyyy>`：未帶 year＝全部；帶則過濾。
- 儀表板與報表頁加年份下拉（選項＝現有資料出現過的年份集合，由 dashboard-data 一併回傳 `availableYears`）。

## 5. 與現有程式的接縫

**已存在、直接重用**：`listOpenPullRequestsByPrefix`、`listSupplierSubmissions`、`getFileSha`、`closePullRequest`、`deleteBranch`（`pr.ts`）；`/files/*`（佐證取回）；`aggregateKpis`（`lib/aggregate.ts`）；`readAggregatedSubmissions`（`admin-api.ts`）；`status:revision` label（`repo.ts`）；`report-lib.mjs` 邏輯（移植來源）。

**`src/github/pr.ts` 新增**：`getFileOnBranch`、`updateFileOnBranch`、`mergePullRequest`、`getPullChecks`、`addLabelToPR`、`removeLabelFromPR`、`commentOnPR`、`getLatestRejectReason`。

**新增檔案**：`src/lib/report.ts`（CSV／GHG 純函式）；審核中心與報表頁的 HTML（比照現有 `src/admin/page.ts`、`src/routes/dashboard.ts` 風格，套用 `/assets/app.css`）。

**修改**：`src/ui/theme.mjs`（`renderNav`）、`src/routes/admin.ts`／`src/routes/dashboard.ts`（套導覽列）、`src/routes/admin-api.ts`（新增 review／report 端點、dashboard-data 加 year）、`src/routes/submit.ts`（退件理由顯示＋原地編輯）、`src/index.ts`（註冊新頁面路由）。

## 6. 測試策略

- **純函式**：`src/lib/report.ts` 的 `toCsv`／`toGhgMarkdown` 以固定輸入測輸出（含年份過濾、空資料）。
- **GitHub helper**：`pr.ts` 新增函式以 mock octokit 測（驗證打對 endpoint＋參數：merge、check-runs、label 增刪、留言、更新分支檔）。
- **路由**：審核 approve／reject、report（csv／md／year 過濾）、原地編輯 POST，以 mock 測行為與狀態碼。
- 兩個 vitest pool（`test:cf` ＋ `test:node`）都要綠。

## 7. 非目標（YAGNI）

- 不做 PR **自動** merge（核定一律人按按鈕）。
- 報表不產 PDF（CSV ＋ Markdown 即可）。
- 不做即時通知／email（沿用現況，Manager 主動看待審清單）。
- 不做盤查員與 Manager 的角色分離（兩者同一人）。
- 佐證檔只提供連結開啟，不做站內預覽器。

## 8. 分階段建議（每階段結束都可運作）

- **Plan 1**：區塊 1（導覽骨架＋登出）— 基礎，讓四頁串起來。
- **Plan 2**：區塊 2（審核中心）— 核心，Manager 可在網頁核定／退件。
- **Plan 3**：區塊 3（供應商退件閉環＋原地編輯）— 補上退件後的修改循環。
- **Plan 4**：區塊 4＋5（報表＋年份篩選）— 輸出與多年份。
