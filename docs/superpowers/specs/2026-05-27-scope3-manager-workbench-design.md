# Scope 3 GitHub App — ESG Manager 工作台補強

## 1. 目的與背景

目前 Worker 只有三個給人用的畫面（供應商填表頁、Manager 管理頁、Manager 儀表板），最大的斷層是**盤查／審核完全在 GitHub PR 上做**，Manager 必須會用 GitHub 才能核定提交。報表只在 GitHub Release、佐證檔沒有檢視介面、管理頁缺導覽與登出。

本案把 Manager 需要的能力補成**一個多頁工作台**：在網頁上完成審核→核定／退件、供應商被退件能在填表頁原地修改重送、線上看與下載報表，全程不必碰 GitHub。

**前提**：盤查員＝ESG Manager 本人（已與使用者確認）。系統的「人」只有兩種角色：**Manager**（GitHub OAuth 登入）與**供應商**（憑 token，無 GitHub 帳號）。

## 2. 核心決策（已與使用者確認）

- 盤查員就是 Manager 本人 → 要在 Worker 內做審核介面。
- 範圍＝一次補到可營運：審核中心＋供應商退件閉環＋報表＋管理頁完善（導覽／登出／年份）。
- 退件後供應商**原地編輯重送**（預填原內容、更新同一 PR 重審），不是撤回重填。
- 報表由 **Worker 即時產生**（讀最新 `data/submissions.json`，移植 report-lib 純函式邏輯到 Worker）。
- 介面骨架＝**多頁＋共用導覽列**。

## 3. 整體架構

四個頁面，全部 session 保護、共用 App installation token，頂部共用導覽列：

| 頁面 | 路由 | 內容 |
|------|------|------|
| 設定 | `/admin/:org` | 盤點年度／類別、供應商 CRUD（現有） |
| 審核 | `/admin/:org/review` | 待審清單、單筆詳情、核定／退件（新增） |
| 儀表板 | `/dashboard/:org` | KPI（現有，加年份篩選） |
| 報表 | `/admin/:org/reports` | GHG 總覽＋下載 CSV（新增） |

導覽列為 `src/ui/nav.ts` 的 `renderNav(org, active, pendingCount)` 函式（**獨立於 `theme.mjs`**——`build:templates` 會 `import { APP_CSS }` 寫入 `tenant-template/docs/app.css` 後再打包整個 `tenant-template/`，故 `theme.mjs` 只應 export CSS、不應混入輸出 HTML 的函式）；各頁 HTML 引用，`active` 標示當前頁，`pendingCount` 為待審筆數。

**核定的把關語意與觸發鏈**：「核定＝merge PR」原本在 GitHub 人工做。Manager 在審核中心按「核定」時，Worker 用 App token 代為 merge 該 PR——仍是**人按按鈕**，把關沒有減少，只是介面從 GitHub 搬進 Worker。這與原 branch/PR spec 的「不做自動 merge」不衝突（自動 merge 指無人把關）。

觸發鏈（已驗證自洽，記錄以免日後誤改 token）：Worker 用 **App installation token** 打 `PUT …/merge` 產生的 main push，**不是** Actions 的 `GITHUB_TOKEN`，故不受「`GITHUB_TOKEN` 觸發的 push 不再觸發 workflow」的反遞迴限制 → 租戶 repo 的 `calculate`（on push main、paths `submissions/**`）會跑；而 `calculate` 自身的 commit 用 `[skip ci]` 且只改 `data/submissions.json`（不在 `submissions/**`），不會自我遞迴。

## 4. 五個區塊（可獨立交付）

### 區塊 1 — 導覽骨架＋登出
- 新增 `src/ui/nav.ts` 的 `renderNav(org, active, pendingCount)`；不放進 `theme.mjs`（見 §3）。
- `/admin/:org`、`/dashboard/:org` 套用導覽列。登出端點 `POST /admin/:org/logout` 已存在但**只清 cookie 回 JSON、不重導**，故登出鈕前端 handler 收到 `{ok:true}` 後需自行導向 `/admin/:org/login`。
- 「審核」分頁旁顯示待審筆數 badge（`sub/` ＋ `withdraw/` open PR 數）。

### 區塊 2 — 審核中心 `/admin/:org/review`
- **待審清單**：分兩類列出 open PR——
  - 提交審核：`listOpenPullRequestsByPrefix(octokit, org, 'sub/')`（已有）。每筆顯示供應商／類別／期間／活動／數量，以及 **validate 狀態燈**。
  - 撤回審核：`listOpenPullRequestsByPrefix(octokit, org, 'withdraw/')`（供應商撤回已核定提交所開的 PR，見 `submit.ts`）。Manager 在 Worker 內即可核可（merge＝確認撤回、刪 main 檔）或拒絕（`commentOnPR` 留理由後關閉 PR，理由留存於 PR 供稽核），不必去 GitHub。
  - **head.sha 依賴**：查 check runs 需 PR head commit SHA。現有 `OpenPR` 介面（`pr.ts`）只有 `head.ref`，**需擴充為 `head:{ ref; sha }`**——GitHub `GET /pulls` 回傳的 `head` 本就含 `sha`，`listOpenPullRequestsByPrefix` 帶出即可。
  - validate 狀態：`pr.ts` 新增 `getPullChecks(octokit, org, sha)` 查 `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`，映射三態：conclusion=success→綠、failure→紅；無 conclusion（in_progress／queued）或查無 check-run（Actions 尚未排程）→ 灰（UI 文案「驗證中」）。
- **單筆詳情**：`pr.ts` 新增 `getFileOnBranch(octokit, org, branch, path)`，**一次回傳該檔 JSON 內容＋blob sha**（`GET contents?ref={branch}`，沿用既有 base64＋TextDecoder 解碼範式）→ 顯示完整欄位；佐證檔以 `evidence_urls` 連到 `/files/*`（已有）；顯示 validate 結果摘要。
- **核定**：`POST /api/v1/admin/:org/review/:pr/approve` → `pr.ts` 新增 `mergePullRequest`（`PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge`）→ 觸發 `calculate` 自動算進儀表板（觸發鏈見 §3）。merge 若因衝突／未就緒失敗，回傳明確錯誤訊息給 Manager。validate 紅燈時前端核定鈕需二次確認（把關在人）。
- **退件**：`POST /api/v1/admin/:org/review/:pr/reject`（body: `reason`）→ `pr.ts` 新增 `addLabelToPR` 加 `status:revision`（label 已存在）＋ `commentOnPR` 留言，格式以明確標記開頭：`<!-- reject -->` ＋ `**退件理由**：<reason>`（供區塊 3 穩定解析，不與 validate 留言混淆）。PR 保持 open。
- audit_log 記錄 `submission_approved` / `submission_rejected`。

### 區塊 3 — 供應商退件閉環（填表頁）
- 填表頁「我的提交紀錄」對每筆 open PR 判定狀態。**PR 的 `labels` 直接取自 `listOpenPullRequestsByPrefix` 清單回應**（GitHub `GET /pulls` 每筆本就含 `labels` 陣列；§5 將 `OpenPR` 一併擴充 `labels`，不另發 N 次請求）。
  - 有 `status:revision` label → 顯示「需修改」（label 比對用 `name`；repo 的 label description「需補件」不影響功能、無需改，UI 文案「需修改」由 Worker 控制），並列出最新退件理由（`pr.ts` 新增 `getLatestRejectReason`：以分頁 `per_page=100` 讀到最末頁、取最後一則含 `<!-- reject -->` 標記者的理由內文，避免 >100 留言時漏讀最新）。
  - `withdraw/{supplier}/{id}` PR（供應商撤回已核定提交所開）→ 對應提交顯示「撤回審核中」，讓供應商看得到撤回進度（在 Manager merge 撤回 PR 前 main 檔仍在、原會顯示「已核定」，需以此覆寫）。撤回被拒（PR 關閉未 merge）後提交回「已核定」；供應商端不另顯示撤回被拒（見 §7）。
  - 其餘 → 維持「審核中」。
- **原地編輯**（僅 `sub/` 的未核定／需修改提交）：
  - `GET /submit/:org/:token/edit/:submissionId` → 以 `getFileOnBranch` 讀該 PR 分支 JSON（**同時取得內容與 blob sha**）→ 回傳預填的編輯表單（重用填表表單，帶入原值與 `submissionId`）。
  - `POST /submit/:org/:token/edit/:submissionId` → **直接** `updateFileOnBranch(octokit, org, branch, path, content, sha)` 更新既有分支檔（`PUT contents` 帶 `branch`＋`sha`，sha 來自上一步；**不經 `processSubmission`**，以保留原 `submission_id`、原分支 `sub/{supplier}/{submissionId}`、原檔路徑，不另開新 PR）→ PR 自動 synchronize → validate 重跑；同時移除 `status:revision` label（`pr.ts` 新增 `removeLabelFromPR`）讓該筆重回「審核中」。
  - submission JSON 內 `submission_id` 維持原值；若 `period`／`scope3_category` 有變，一併更新 PR 標題（沿用 `openPullRequest` 標題格式）。
  - 時序註記：移除 label 即時，但更新分支後 PR head sha 改變，新 sha 的 validate check-run 在 Actions 排程前尚不存在 → 狀態燈短暫顯示灰（「驗證中」），待重跑完成轉綠／紅（最終一致，可接受）。
- 取代 Plan B 當時以「撤回重填」暫代的編輯方案；既有撤回功能保留。

### 區塊 4 — 報表 `/admin/:org/reports`
- 將 report-lib 純函式**移植**進 Worker：`src/lib/report.ts` 匯出 `toCsv(submissions)` 與 `toGhgMarkdown(submissions, year)`（邏輯同 `tenant-template/scripts/report-lib.mjs`，改寫為 TS；CSV 欄位含 `source_file`）。⚠️ 此為**第二份同邏輯程式碼**（租戶 repo 端 `.mjs` 仍保留供 `report.yml` 用），兩處須同步維護，並以相同輸入的交叉測試確保輸出一致。`toGhgMarkdown` 的 `year` 僅作標題、不自行過濾，過濾由 API 先行處理。
- 頁面：年份下拉 → 顯示該年 GHG 總覽（總排放、各類別）＋「下載 CSV」按鈕。
- API：`GET /api/v1/admin/:org/reports?year=<yyyy>&format=csv|md`（路徑用複數 `reports`，與頁面一致）
  - 讀 `data/submissions.json`，依 `year`（`period` 前 4 碼，同區塊 5 規則）過濾，呼叫 `toCsv`／`toGhgMarkdown` 即時產生。
  - 取得彙整資料重用 `admin-api.ts` 內既有的 `readAggregatedSubmissions`；因報表 API 同放在 `admin-api.ts`，為**同檔呼叫**（該函式為 module-private，無需 export）。
  - `format=csv` 回 `text/csv` 附 `Content-Disposition: attachment`。`format=md` 回 `text/markdown` 為**選配、僅 API 支援**（頁面不放 md 下載鈕；需求僅明列「線上看總覽＋下載 CSV」，md 為低成本加值）。

### 區塊 5 — 年份篩選
- 年份取自 `submission.period` 前 4 碼（`period.slice(0,4)`，如 `2025-Q2` → `2025`）；報表（區塊 4）沿用同一規則。
- `GET /api/v1/admin/:org/dashboard-data?year=<yyyy>`：未帶 year＝全部；帶則過濾。**過濾在路由層做**——先依 year filter `submissions` 陣列再餵 `aggregateKpis`（該函式本身不改）；`availableYears` 由路由掃 `period` 前 4 碼去重後一併回傳。
- 儀表板與報表頁加年份下拉（選項＝`availableYears`）。

## 5. 與現有程式的接縫

**⚠️ 外部前置（GitHub App 權限，實作區塊 2 前必須以 `gh api`／App 設定頁確認，勿假設）**：
- `mergePullRequest`（核定＝`PUT .../pulls/{n}/merge`）需 **Pull requests: Read & write**——branch/PR 重構時已新增並核准（現有 `openPullRequest`／`closePullRequest` 能運作為證）。
- `getPullChecks`（validate 狀態燈＝`GET .../commits/{sha}/check-runs`）需 **Checks: Read**——**可能尚未授予**；缺則先走授權流程（改權限後須到 installation 頁重新核准）再實作。連帶補登 `docs/維運手冊/02-環境與設定.md` 權限表。若該權限暫不可得，狀態燈可降級為不顯示（不阻擋核定／退件主流程）。
- 標籤／留言（`addLabelToPR`／`removeLabelFromPR`／`commentOnPR`／`getLatestRejectReason`）走 Issues API，由現有 **Issues: Read & write** 覆蓋，無需新增。

**已存在、直接重用**：`listOpenPullRequestsByPrefix`、`listSupplierSubmissions`、`closePullRequest`、`deleteBranch`（`pr.ts`）；`/files/*`（佐證取回）；`aggregateKpis`（`lib/aggregate.ts`）；`status:revision` label（`repo.ts`）；`report-lib.mjs` 邏輯（移植來源）。
（註：`getFileSha`（`pr.ts`）只查 main、不帶 ref，**不適用**原地編輯的分支檔；`readAggregatedSubmissions` 為 `admin-api.ts` module-private，報表 API 同檔呼叫即可，不跨檔 import；`aggregateKpis` 不接受 year／不回 availableYears，年份過濾須在路由層先 filter `submissions` 再餵入，`availableYears` 由路由掃 `period` 另算。）

**`src/github/pr.ts` 需修改**：擴充 `OpenPR` 介面為 `head:{ ref; sha }` ＋ `labels: { name: string }[]`，並讓 `listOpenPullRequestsByPrefix` 帶出 `GET /pulls` 回應中既有的 `head.sha` 與 `labels`（避免後續 N 次額外請求）。

**`src/github/pr.ts` 新增**：`getFileOnBranch`（回內容＋sha）、`updateFileOnBranch`（帶 branch＋sha）、`mergePullRequest`、`getPullChecks`、`addLabelToPR`、`removeLabelFromPR`、`commentOnPR`、`getLatestRejectReason`。

**新增檔案**：`src/ui/nav.ts`（`renderNav`，輸出 HTML 導覽列）；`src/lib/report.ts`（CSV／GHG 純函式）；審核中心與報表頁的 HTML（比照現有 `src/admin/page.ts`、`src/routes/dashboard.ts` 風格，套用 `/assets/app.css`）。

**修改**：`src/routes/admin.ts`／`src/routes/dashboard.ts`（套導覽列）、`src/routes/admin-api.ts`（新增 review／reports 端點、dashboard-data 加 year）、`src/routes/submit.ts`（退件理由顯示＋原地編輯；GET 需另查 `listOpenPullRequestsByPrefix('withdraw/{supplier}/')` 以覆寫已核定筆的「撤回審核中」）、`src/index.ts`（註冊新頁面路由）。`src/ui/theme.mjs` **不改**（renderNav 改放 nav.ts）。

## 6. 測試策略

- **純函式**：`src/lib/report.ts` 的 `toCsv`／`toGhgMarkdown` 以固定輸入測輸出（含年份過濾、空資料）。**雙份一致性交叉測試**置於 `tests/lib/`（Node pool，可同時 `import` `.ts` 與 tenant-template 的 `.mjs`），同一 fixture 斷言兩者輸出逐字相等。
- **GitHub helper**：`pr.ts` 新增函式以 mock octokit 測（驗證打對 endpoint＋參數：merge、check-runs、label 增刪、留言、更新分支檔）。`getPullChecks` 狀態映射須測 success／failure／in_progress（無 conclusion）／空陣列 四情境對應 綠／紅／灰／灰。
- **接縫測試（易錯處）**：`listOpenPullRequestsByPrefix` 確實帶出 `head.sha` 與 `labels`；`getFileOnBranch` 同時回內容與 sha、且該 sha 被 `updateFileOnBranch` 正確帶入 `PUT contents`（驗證原地編輯不誤用 main 的 sha）；供應商頁依 `labels` 是否含 `status:revision` 正確判定「需修改／審核中」、`withdraw/` PR 顯示「撤回審核中」；`getLatestRejectReason` 只認 `<!-- reject -->` 標記、不誤抓 validate 留言、多留言取最新。
- **路由**：審核 approve／reject、reports（csv／md／year 過濾）、原地編輯 POST，以 mock 測行為與狀態碼。
- 兩個 vitest pool（`test:cf` ＋ `test:node`）都要綠。

## 7. 非目標（YAGNI）

- 不做 PR **自動** merge（核定一律人按按鈕）。
- 報表不產 PDF（CSV ＋ Markdown 即可）。
- 不做即時通知／email（沿用現況，Manager 主動看待審清單）。
- 不做盤查員與 Manager 的角色分離（兩者同一人）。
- 佐證檔只提供連結開啟，不做站內預覽器。
- 撤回被 Manager 拒絕的情境不在供應商填表頁顯示（罕見；拒絕理由留存於 PR 供稽核，Manager 視需要線下告知），以免為邊角狀態增加 closed PR 查詢。

## 8. 分階段建議（每階段結束都可運作）

- **Plan 1**：區塊 1（導覽骨架＋登出）— 基礎，讓四頁串起來。
- **Plan 2**：區塊 2（審核中心）— 核心，Manager 可在網頁核定／退件。
- **Plan 3**：區塊 3（供應商退件閉環＋原地編輯）— 補上退件後的修改循環。
- **Plan 4**：區塊 4＋5（報表＋年份篩選）— 輸出與多年份。
