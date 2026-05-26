# Scope 3 GitHub App — 手動授權步驟

> ⚠️ **歷史文件，僅記錄初次設定過程。** 設定已全部完成。
> **正式使用的 GitHub App 是 `scope3esg`（App ID `3863190`，client_id `Iv23li8KLFZL6RUQORRz`）**——本文下方 B 段最初描述的 `yao-care-app`（3854967）後來因被其他專案共用而**棄用**。最新且正確的環境值請以專案根 `CLAUDE.md` 與 `docs/維運手冊/02-環境與設定.md` 為準。
>
> 標 🧑 = 你做；🤖 = 你把值給我後我代做。
> Worker 網址：`https://scope3-worker.lightman-chang.workers.dev`（已部署上線，`/health` 正常）

---

## A. 啟用 Cloudflare R2 ✅ 完成

R2 已啟用，`scope3-files` bucket 已建立，Cloudflare 部署已轉綠。

---

## B. GitHub App `yao-care-app` — 已建立，但設定不完整 🧑

App 已存在（https://github.com/organizations/yao-care/settings/apps/yao-care-app）。我用 API 查到：

- **App ID = `3854967`** ✅（已填入 wrangler.toml）
- **Client ID = `Iv23lit1XsR6Fe1vjBXy`** ✅（目前程式碼未用到，OAuth 功能保留）

但目前權限與事件**不符需求**，請到上面那個 App 設定頁補：

### B-1. Repository permissions（目前只有 Issues + Metadata）
| 權限 | 改成 |
|------|------|
| Issues | Read and write（已有） |
| Contents | **Read and write** ← 補 |
| Pages | **Read and write** ← 補 |
| Actions | **Read and write** ← 補 |
| Workflows | **Read and write** ← 補 |
| Metadata | Read-only（已有） |

### B-2. Organization permissions
| 權限 | 改成 |
|------|------|
| Members | **Read-only** ← 補 |

### B-3. 先到「General」頁啟用 webhook（⚠️ 這步沒做，事件區塊不會出現！）
左側選單最上面的 **General**，找到 **Webhook** 區塊：
- 勾選 ☑ **Active**
- **Webhook URL** = `https://scope3-worker.lightman-chang.workers.dev/webhook`
- **Secret** = 設一組（`openssl rand -hex 32`），記下來
- 按該區塊的 Save

同一個 General 頁，順便取得我要的機密：
- **Private keys** 區塊（頁面下方）→ **Generate a private key** → 自動下載 `.pem` → 內容給我
- （Client secret 不需要）

### B-4. 回到「Permissions & events」頁，勾選事件
啟用 webhook 後，Permissions 框下方就會出現 **Subscribe to events**：
勾選 ☑ **Installation target**　☑ **Issues**　☑ **Label**　☑ **Push** → Save changes

### B-5. 改完權限後
若 App 已安裝在 org，需到 installation 頁**核准新權限**。

---

## 還需要你給我 2 個機密（GitHub 不開放 API 查詢）🧑→🤖

到 App 設定頁取得後貼給我：

1. **Private key**：點 **Generate a private key** → 下載 `.pem` → 貼內容給我（App 認證核心，**必要**）
2. **Webhook secret**：B-4 設定的那組（**必要**）

---

## C. Resend — 不使用 ✅ 已改方案

你選擇**手動遞送**供應商連結，不用 Resend。已改為：
**config.yml push 產生 token 後，Worker 自動把所有供應商的專屬填表連結寫進你租戶 repo 的 `supplier-links.md`**（private repo，只有 org 成員看得到）。你在 repo 裡複製連結傳給供應商即可。

> `RESEND_API_KEY` 未設時程式碼自動略過寄信，不報錯。

---

## D. 設定 Worker secrets 🤖（你給我上面 2 個機密後我代做）

```bash
wrangler secret put GITHUB_APP_PRIVATE_KEY    # 貼上 .pem 檔內容
wrangler secret put GITHUB_WEBHOOK_SECRET     # B-4 的 webhook secret
```

`GITHUB_APP_ID = "3854967"` 已填入 wrangler.toml。Client ID/secret、Resend 目前都不需要。

> 目前狀態：❌ 2 個必要 secret 尚未設定（等你給值）

---

## E. 安裝 / 重新授權 App 到 org 🧑（B、D 完成後）

1. App 設定頁 → **Install App** → 安裝到 `yao-care`（或核准更新後的權限）
2. 安裝後 Worker 收到 `installation` webhook → 自動建立 `scope3-inventory` repo（含 labels、config.yml、排放係數、validate/calculate/pages/report workflows、儀表板）

---

## 進度對照

| 項目 | 誰做 | 狀態 |
|------|------|------|
| 程式碼（Worker、三管道、驗證/計算、儀表板、報表、供應商連結寫回） | 🤖 我 | ✅ 完成 |
| 部署上線（/health 正常） | 🤖 我 | ✅ 完成 |
| A. 啟用 R2 + 建 bucket | — | ✅ 完成 |
| B. GitHub App 權限/事件設定 | 🧑 你 | ⏳ 待補（見 B-1~B-5） |
| 提供 private key + webhook secret | 🧑 你 | ⏳ 待給 |
| C. 供應商連結遞送 | 🤖 我 | ✅ 改為 supplier-links.md |
| D. 設定 2 個 secret | 🤖 我（需你給值） | ⏳ 待辦 |
| E. 安裝/授權 App | 🧑 你 | ⏳ 待辦 |

**剩下就差 B（補 App 權限/事件 + 給我 private key 和 webhook secret）→ 我設 secret → 你安裝 App，就能端到端跑起來。**
