# Scope 3 GitHub App — Branch/PR 盤查模型（取代 Issue-based）

## 1. 目的與背景

把盤查模型從「GitHub Issue = 一筆提交、label 審核」改為「**branch/PR = 一筆提交、PR review + merge 審核**」。更 git-native：版本、編輯、撤回都用 git 原生機制；盤查留下 commit/PR 軌跡。

這是對既有 Issue-based 實作（Plan 2–4）的重大重構，分階段進行。

## 2. 核心模型

- **一筆提交 = 一個檔案 + 一個分支 + 一個 PR**。
- 檔案：`submissions/{supplier_id}/{submission_id}.json`（內容 = 原 scope3-data 欄位：supplier_id、scope3_category、period、activity_type、amount、unit、evidence_urls、submitted_at、channel、emission_factor_id、calculated_co2e）。`submission_id` = uuid。
- 分支：`sub/{supplier_id}/{submission_id}`，從 main 開。
- PR：分支 → main，標題 `[{supplier_name}] Cat.{N} {period} {activity}`，body 含人類可讀摘要表（給盤查員）。
- **狀態以 PR 狀態表達**：open = 待審/審核中；merged = 已核定；closed(未 merge) = 已撤回/退回。需補件用 PR 留言 + `revision` label（可選）。

## 3. 端到端流程

### 3.1 提交（供應商憑 token，無 GitHub 帳號）
Worker `processSubmission`（branch 版）：
1. 驗 token → supplier_id（D1，不變）。
2. 取 main 最新 commit sha（`GET /repos/{o}/{r}/git/ref/heads/main`）。
3. 建分支 `sub/{supplier_id}/{submission_id}`（`POST /repos/{o}/{r}/git/refs`）。
4. 在分支 commit 檔案 `submissions/{supplier_id}/{submission_id}.json`（`PUT contents`，branch 參數）。
5. 開 PR（`POST /repos/{o}/{r}/pulls`，head=分支, base=main）。
6. 寫 audit_log（action=submission_pr_opened）。

### 3.2 驗證（PR）
租戶 repo workflow `validate.yml` 改 `on: pull_request`（types opened/synchronize）：
- 取 PR 變更的 `submissions/**/*.json` → 跑 lib.mjs 驗證（單位/異常/缺件）→ 結果為 PR 留言；有問題時 PR check 失敗（exit code）或加 `validation:error` label。

### 3.3 審核（盤查員，真人 GitHub）
- 在 PR 看 diff（JSON）+ body 摘要 + validate 結果。
- 要求修改 → PR 留言（並可加 `revision` label）。
- 核定 = **merge PR**。

### 3.4 計算（merge 後）
租戶 repo workflow `calculate.yml` 改 `on: push`（branches main, paths `submissions/**`）：
- 找出本次 push 新增/變更的 `submissions/**/*.json` → 對每個查排放係數算 co2e → 寫回該檔案的 `calculated_co2e` 與 `emission_factor_id` → 重建彙整 `data/submissions.json`（掃所有 submissions 檔）→ commit main。

### 3.5 編輯
- **未核定（open PR）**：供應商在填表頁點編輯 → Worker 更新該分支的檔案（`PUT contents` with sha, branch）→ PR 自動更新 → validate 重跑。
- **已核定（PR merged）**：Worker 從 main 開新分支 + 改 main 上該檔案 + 開新 PR → 重審。

### 3.6 撤回
- **未核定**：Worker 關 PR（`PATCH pulls state=closed`）+ 刪分支（`DELETE refs`）。
- **已核定**：Worker 開分支刪除該檔 + 開 PR（撤回需經盤查員 merge 才生效，保留稽核）。

### 3.7 供應商清單（填表頁）
填表頁 GET 時，Worker 查該供應商：
- 已核定：`GET contents submissions/{supplier_id}/`（main 上的檔案）。
- 待審：`GET /repos/{o}/{r}/pulls?state=open` 過濾 head 分支前綴 `sub/{supplier_id}/`。
- 合併成清單（期間/類別/活動/數量/狀態/co2e）+ 編輯/撤回鈕。

### 3.8 admin / 儀表板
- 儀表板讀 main `data/submissions.json`（calculate 維護，不變）。
- admin overview：每供應商統計改為「main 檔案數（已核定）+ open PR 數（待審）」。

## 4. 需要的權限（手動授權前提）
GitHub App 目前無 **Pull requests** 權限。branch/PR 模型需加 **Pull requests: Read and write**（開/改/合併/關 PR）。Contents: write 已有（建分支/commit）。使用者須在 App 設定加此權限並核准。

## 5. 分階段（各自一個 plan，每階段結束都是可運作狀態）

- **Plan A — branch/PR 核心端到端**（一次到位，避免中間不一致）：
  - GitHub helper（`src/github/pr.ts`）：取 main sha、建分支、commit on branch、開 PR、列 PR。
  - `processSubmission` 改建分支+commit+開 PR（取代建 Issue）；三管道共用。
  - validate.yml 改 `on: pull_request`（驗 PR 變更的 submissions JSON）。
  - calculate.yml 改 `on: push`（main, paths `submissions/**`）→ 算 co2e、重建 `data/submissions.json`。
  - 這階段完成後：提交→PR→validate→（人工 merge）→calculate→submissions.json 全通。
- **Plan B — 供應商清單 + 編輯/撤回**：填表頁加「我的提交紀錄」（查 main 檔案 + open PR）；編輯/撤回端點對應 PR 操作（更新分支 / 關 PR / 已核定開新 PR）。
- **Plan C — admin/儀表板改讀新源 + 清理 Issue 舊碼**：admin overview 改查檔案+PR 計數；移除 `createSubmissionIssue`、`src/github/issue.ts`、submission.ts 的 dispatch、Issue-based validate/calculate 殘留。（dashboard 讀 submissions.json 不變。）

## 6. 過渡

- 既有 Issue-based 的 demo 提交（Issue #3 等）為測試資料，重構後以 branch/PR 為準；舊 Issue 可關閉/刪除（demo），不遷移。
- `data/submissions.json` 格式不變（calculate 維護），dashboard 不受影響。

## 7. 測試策略

- 純函式（lib.mjs 驗證/計算）測試不變。
- GitHub helper（建分支/PR）以 mock octokit 測試（驗證呼叫正確 endpoint + 參數）。
- processSubmission（branch 版）以 mock 測試：驗證建分支 + commit + 開 PR 流程。
- 供應商清單/編輯/撤回：mock octokit（list PRs、contents）測試。
- workflow（validate on PR、calculate on push）腳本的純邏輯測試；workflow 觸發於實際租戶 repo 驗證。

## 8. 非目標

- 不要求供應商有 GitHub 帳號（仍憑 token，Worker 代理所有 git 操作）。
- 盤查員看 PR diff 為 raw JSON + PR body 人類可讀摘要；不另做 diff 美化 UI（YAGNI）。
- 不做 PR 自動 merge（核定一律人工 merge，保留盤查把關）。
- 佐證檔仍存 R2，JSON 的 evidence_urls 指向 `/files/...`（不變）。
