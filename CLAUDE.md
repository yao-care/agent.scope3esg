# Scope 3 GitHub App — 專案規則與除錯線索

> 這是多租戶 GitHub App（Cloudflare Workers），ESG 公司安裝後自動在其 org 建立 `scope3-inventory` repo 來盤點 Scope 3 碳排。程式碼在 `scope3-worker/`。

## ⚠️ 除錯前必讀：踩過的雷（按出現頻率）

除錯時**先查這裡，不要憑症狀亂猜**。詳見 `docs/維運手冊/03-除錯指南.md`。

1. **安裝 webhook 回 500 / `no such table: tenants`** → production D1 沒套 migration。**CI 不會自動套**。修：`cd scope3-worker && wrangler d1 migrations apply scope3 --remote`。
2. **GitHub App 認證失敗 / JWT 錯誤** → private key 必須 **PKCS8**（`-----BEGIN PRIVATE KEY-----`）。GitHub 下載的是 PKCS1（`BEGIN RSA PRIVATE KEY`），Workers Web Crypto 不吃。轉換：`openssl pkcs8 -topk8 -nocrypt -in x.pem -out x-pkcs8.pem`。
3. **`gh`/`curl` 查詢回 404 或 EOF/ECONNRESET** → 這台機器對外網路**很不穩**，常是假失敗。**別信單次查詢結果**；wrangler/gh/curl 一律包重試迴圈，且加 `dangerouslyDisableSandbox: true`（沙箱會擋對外連線）。
4. **重複安裝 / webhook 重送** → `createTenantRepo`（repo 已存在）與 `insertTenant`（主鍵衝突）已改為 idempotent。若再遇衝突先確認這兩處邏輯沒被改壞。
5. **既有租戶 repo 缺新模板檔** → `createTenantRepo` 對「已存在的 repo」是 idempotent 跳過，**不會補新增的模板檔**。在 `tenant-template/` 新增檔案後，既有 repo 需手動補（用 `gh api PUT contents`）。

## 環境關鍵值（事實，不要猜）

| 項目 | 值 |
|------|----|
| Worker URL | `https://scope3-worker.lightman-chang.workers.dev` |
| Cloudflare account | `9d9e58b5e0d1657b8f74bd2cbfc91ee3` |
| D1 database | `scope3`（id `b49b85a5-b624-4b4f-bc59-85454aa6077f`） |
| R2 bucket | `scope3-files` ｜ Queue：`scope3-pull-jobs` |
| GitHub App（正式用） | `scope3esg`，App ID `3863190`，client_id `Iv23li8KLFZL6RUQORRz` |
| ~~舊 App~~ | `yao-care-app`（3854967）被其他專案共用，**已棄用，勿動** |
| 第一個租戶 | org `yao-care`，installation `135631719`，repo `yao-care/scope3-inventory` |
| Cloudflare API token | 由使用者提供（`cfat_` 開頭）；wrangler 命令前帶 `CLOUDFLARE_API_TOKEN=...` |

**已設定的 Worker secrets**：`GITHUB_APP_PRIVATE_KEY`(PKCS8)、`GITHUB_WEBHOOK_SECRET`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET`、`SESSION_SECRET`。**`RESEND_API_KEY` 未設**（使用者選擇不寄信，改手動遞送連結；程式碼未設則略過寄信，正常）。

## 開發紀律（此專案特定）

- 套件管理一律 **pnpm**（不用 npm）。
- 測試有**兩個 vitest pool**，務必都跑：`pnpm test`（= `test:cf` Cloudflare pool + `test:node` Node pool）。
- 部署：`git push`（觸發 GitHub Actions）或手動 `wrangler deploy`。CI 會跑 `build:templates` + `pnpm test`。
- 租戶 repo 檔案的單一事實來源是 `scope3-worker/tenant-template/`；改完要跑 `pnpm run build:templates` 產生 `src/templates/generated.ts`（已 commit）。
- git 直接在 `main` 開發並 push（使用者要求；勿擅自開 feature branch）。

## 常用除錯指令

```bash
# Worker 即時日誌（看 webhook/API 錯誤）
cd scope3-worker && CLOUDFLARE_API_TOKEN=... pnpm wrangler tail --format json

# 模擬一次 installation webhook 觸發建 repo（需 webhook secret 簽 HMAC，見除錯指南）
# 查 D1 租戶
CLOUDFLARE_API_TOKEN=... pnpm wrangler d1 execute scope3 --remote --command "SELECT * FROM tenants"

# 健康檢查
curl https://scope3-worker.lightman-chang.workers.dev/health
```

## 文件地圖

- `docs/維運手冊/` — 分層維運手冊（架構、環境、除錯、操作）
- `docs/SETUP-手動授權步驟.md` — GitHub App / R2 / secret 設定步驟
- `docs/superpowers/specs/` — 設計 spec ｜ `docs/superpowers/plans/` — 實作計畫（Plan 1–5）

## 端到端流程（一句話）

安裝 App → Worker 自動建 `scope3-inventory` repo → ESG Manager 用 `/admin/:org` 網頁管理介面（GitHub 登入）填供應商 → 自動產生填表連結 → 供應商三管道提交（表單/API/Pull）→ 租戶 repo 的 Actions 驗證/計算 → 儀表板/報表。
