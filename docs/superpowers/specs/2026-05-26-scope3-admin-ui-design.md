# Scope 3 GitHub App — ESG Manager 管理介面設計

## 1. 目的

讓 ESG Manager（業務人員，非工程師）透過 Web 管理介面維護盤點設定與供應商清單，**不需直接編輯 GitHub repo 裡的 `config.yml`**。介面由 Worker 服務、以 GitHub OAuth 驗證身分，儲存時寫回租戶 repo 的 `config.yml` 並觸發既有的供應商 token 同步流程。

## 2. 角色與權限

- **ESG Manager**：該 org 的 GitHub 成員（active membership 即可，本期不細分 admin/member role）。唯一能存取管理介面的角色。
- 驗證原則：A 公司的人只能管理 A 公司的盤點（透過 org 成員資格驗證）。

## 3. 整體架構（Worker-served 單頁介面）

沿用現有「Worker serve HTML + 後端 API」模式（與 `/submit` 供應商表單一致）。所有租戶共用同一套程式碼，以網址中的 `:org` 區分。前端為 vanilla JS 單頁（無框架），與現有風格一致。

### 路由

```
GET  /admin/:org              管理頁 HTML（未登入 → 導向 GitHub 登入）
GET  /admin/:org/login        重導向 GitHub OAuth 授權
GET  /admin/callback          GitHub 回呼：驗證身分、發 session、導回管理頁
POST /admin/:org/logout       清除 session
```

### 管理 API（皆需有效 session，且 cookie 的 org 與路徑 org 相符）

```
GET  /api/v1/admin/:org/config       讀 config.yml → 回 JSON
PUT  /api/v1/admin/:org/config       收 JSON → 轉 YAML 寫回 config.yml → 觸發 syncConfig
GET  /api/v1/admin/:org/links        供應商連結清單（查 D1 supplier_tokens）
GET  /api/v1/admin/:org/submissions  查 repo issues → 各供應商提交/審核狀態
```

## 4. OAuth 登入流程

1. 管理者開 `/admin/:org` → 中介層檢查 session cookie。
2. 無有效 session → 導向 `/admin/:org/login` → 組出 GitHub OAuth authorize URL（含 `client_id`、`redirect_uri=<WORKER_BASE_URL>/admin/callback`、`state`）並重導。
3. `state` 為簽章字串，內含 `org` 與隨機 nonce，用 `SESSION_SECRET` 簽章（HMAC），防 CSRF 並在 callback 還原 org。
4. 管理者於 GitHub 授權 → 導回 `/admin/callback?code=…&state=…`。
5. Worker 驗證 `state` 簽章 → 取出 org。
6. 用 `code` + `GITHUB_APP_CLIENT_ID` + `GITHUB_APP_CLIENT_SECRET` 向 `POST https://github.com/login/oauth/access_token` 換使用者存取權杖。
7. 用該權杖 `GET /user` 取得登入帳號；以 `GET /orgs/{org}/memberships/{username}` 確認其為該 org 成員（`state` 為 active）。非成員 → 403。
8. 通過 → 簽發 session cookie（見第 5 節）→ 導回 `/admin/:org`。

## 5. Session 管理

- **無狀態簽章 cookie**：cookie 值為 `base64url(payload).signature`，payload 為 JSON `{ org, user, exp }`，signature 為 `HMAC-SHA256(payload, SESSION_SECRET)`。
- Cookie 屬性：`HttpOnly`、`Secure`、`SameSite=Lax`、`Path=/`、`Max-Age=28800`（8 小時）。
- 驗證：解析 cookie → 重算 HMAC 比對 → 檢查 `exp` 未過期 → 檢查 `org` 與請求路徑的 `:org` 相符。任一不符 → 401。
- 不需在 D1 儲存 session（無狀態）。

## 6. 資料流

- **讀設定**：Worker 用 `getInstallationOctokit` 取 installation token → 讀 repo `config.yml` → `js-yaml` 解析 → 回前端 `{ inventory_year, enabled_categories, suppliers[] }`。
- **存設定**：前端送上述 JSON → Worker 驗證結構 → `js-yaml` 轉 YAML → `PUT contents`（帶現有檔案 sha）寫回 `config.yml` → 呼叫既有 `syncConfig(env, org, installationId)` 產 token 並更新 `supplier-links.md`。
- **連結一覽**：查 D1 `supplier_tokens`（依 org）→ 以 `generateFormUrl` 組出每家填表網址。
- **提交狀態**：用 installation token 查 repo issues（`GET /repos/{owner}/{repo}/issues?state=all&labels=…`）→ 解析每個 issue body 的 `scope3-data` JSON 與 `status:*` label → 彙整每家供應商「已提交筆數 + 各筆審核狀態」。

## 7. 前端頁面（單頁，4 區塊）

1. **盤點設定**：`inventory_year` 數字輸入 + 15 個 Scope 3 類別 checkbox（對應 `enabled_categories`）。
2. **供應商清單**：表格，每列為一家供應商（id、name、contact、pull_api、pull_schedule），可新增列、編輯、刪除。
3. **連結一覽**：每家供應商一列，顯示專屬填表網址 + 「複製」按鈕。
4. **提交狀態**：每家供應商顯示已提交筆數與審核狀態摘要。

「儲存設定」按鈕：把區塊 1+2 的內容組成 JSON，`PUT` 到 config API。儲存成功後重新載入連結一覽（因為可能產生新 token）。

## 8. 安全

- OAuth `state` 簽章防 CSRF。
- 嚴格驗證 org 成員資格（跨租戶隔離）。
- session cookie HMAC 簽章、HttpOnly、Secure、有效期限。
- 管理 API 一律檢查 session 且 org 相符。
- `GITHUB_APP_CLIENT_SECRET`、`SESSION_SECRET` 存為 Worker secret，不入版控。

## 9. 需要的設定

- **新 secret**：
  - `GITHUB_APP_CLIENT_SECRET` — 由使用者在 App 設定頁「Client secrets → Generate a new client secret」產生後提供。
  - `SESSION_SECRET` — 由 Claude 產一組隨機值並 `wrangler secret put` 設定，不需使用者處理。
- **GitHub App 設定**：需啟用 user authorization (OAuth)；Callback URL 設為 `<WORKER_BASE_URL>/admin/callback`。Client ID 已知（`Iv23lit1XsR6Fe1vjBXy`）。

## 10. 測試策略

- **純函式單元測試**（node pool）：session cookie 簽發/驗證（HMAC、過期、org 比對）、state 簽發/驗證、config JSON↔YAML 轉換。
- **路由測試**（Cloudflare pool）：管理 API 在無 session 時回 401、org 不符回 401/403；config GET/PUT 流程（mock octokit + syncConfig）。
- OAuth 與 GitHub 的實際往返、org 成員驗證以 mock GitHub API 測試。

## 11. 非目標（本期不做）

- 排放係數的 UI 編輯（仍由 admin 直接維護 `data/emission-factors.json`）。
- 審核動作（核定/退件）UI——審核仍在 GitHub Issues/看板進行。
- 多語系切換（先繁中）。
- 細緻的 RBAC（先以「org 成員即可管理」為界；Reviewer/Auditor 區分留待後續）。

## 12. 對既有程式碼的影響

- 重用：`getInstallationOctokit`、`getTenantByOrg`、`syncConfig`、`listSupplierTokensByOrg`、`generateFormUrl`、`readTenantConfig`、`js-yaml`。
- 新增：`src/routes/admin.ts`（頁面 + OAuth 路由）、`src/routes/admin-api.ts`（管理 API）、`src/lib/session.ts`（session/state 簽發驗證）、`src/lib/config-yaml.ts`（config JSON↔YAML）、前端 HTML/JS 模板。
- `types.ts` 的 `Bindings` 加 `SESSION_SECRET`。
