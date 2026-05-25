# Scope 3 Supplier Carbon Data Governance Platform — GitHub App Edition

## 1. 專案概述

### 1.1 專案名稱

Scope 3 GitHub App

### 1.2 核心設計哲學

- **GitHub App 多租戶 SaaS**：ESG 公司在 GitHub Marketplace 安裝即用，無需自架伺服器
- **GitHub-native**：盤點資料存在客戶自己的 GitHub org，資料主權歸客戶
- **Fork-ready**：程式碼開源，有能力的公司可 fork 後自行部署自己的實例

### 1.3 專案目的

協助企業收集、管理、驗證供應鏈 Scope 3 碳排資料，解決以下核心問題：

| 問題 | 說明 |
|------|------|
| 資料分散 | Excel / Email / PDF 四散 |
| 格式不一致 | 單位、產品、排放係數混亂 |
| 缺乏稽核軌跡 | 無法追蹤修改與審核紀錄 |
| 供應商 ESG 能力不足 | 不理解碳盤查與 Scope 3 |
| 缺乏 API | ERP / SCM 無法整合 |
| 無法規模化 | 供應商數量過大 |

支援標準：GHG Protocol / ISO 14064-1 / IFRS S2，未來支援 PCF 與 CBAM。

---

## 2. 系統角色

| Role | 說明 | GitHub 對應 |
|------|------|-------------|
| Supplier | 提交碳排資料 | 無 GitHub 帳號，以 token URL 存取 |
| Reviewer | 審核供應商資料 | GitHub org member（盤查員） |
| ESG Manager | 管理調查、設定類別、邀請供應商 | GitHub org admin |
| Auditor | 查核稽核，唯讀 | GitHub org member（read-only） |
| Admin | 系統管理、排放係數維護 | GitHub org owner / App 管理員 |

---

## 3. 技術架構

三層結構：

```
┌─────────────────────────────────────────────┐
│         GitHub App（全局一個部署）            │
│  ESG 公司安裝 → 自動在其 org 建立盤點 repo   │
└───────────────────┬─────────────────────────┘
                    │ webhook / GitHub API
┌───────────────────▼─────────────────────────┐
│         Cloudflare Workers（API 層）          │
│  ・供應商 Web Form 端點                      │
│  ・供應商 Push API（接收）                   │
│  ・Pull Job Scheduler（主動拉取）            │
│  ・Cloudflare D1：tenant 設定、token、排程   │
│  ・Cloudflare Queues：非同步任務             │
└──────┬────────────┬──────────────┬──────────┘
       │            │              │
┌──────▼────────────▼──────────────▼──────────┐
│   各 ESG 公司的 scope3-inventory repo        │
│  Issues：每筆單據一個（結構化 JSON body）    │
│  Labels：15 個 Scope 3 類別 + 審核狀態      │
│  Projects：盤查員審核看板                   │
│  Actions：驗證、計算、報告產出 workflow     │
│  Pages：進度儀表板                          │
│  Releases：最終報告（Excel / PDF）          │
└─────────────────────────────────────────────┘
```

### 3.1 GitHub App 設定

- **Webhook URL**：`https://scope3.yao.care/webhook`
- **Permissions**：Issues (RW), Contents (RW), Pages (W), Actions (RW), Members (R)
- **Events**：`issues`, `issue_comment`, `installation`, `label`

### 3.2 Cloudflare Workers

| 路由 | 功能 |
|------|------|
| `POST /webhook` | 接收 GitHub webhook |
| `GET/POST /submit/:org/:supplier_token` | 供應商 Web Form |
| `POST /api/v1/submit` | 供應商 Push API |
| `POST /api/v1/pull/:job_id` | 手動觸發拉取 |
| `POST /api/v1/upload/:org/:supplier_token` | 佐證文件上傳（回傳 R2 URL）|

**佐證文件儲存**：供應商透過 Web Form 上傳文件 → 存入 Cloudflare R2（per-tenant bucket）→ 產生帶簽章的 URL → 存入 Issue JSON 的 `evidence_urls`。文件不進 GitHub repo，避免 LFS 費用。

**Email 服務**：使用 Resend（或 Cloudflare Email Workers）發送邀請、補件通知、提醒信。API key 存入 Cloudflare Workers 環境變數。

**Cloudflare D1 schema（輕量，非業務資料）：**

```sql
tenants (installation_id, org, config_updated_at)
supplier_tokens (token, org, supplier_id, expires_at)
pull_jobs (job_id, org, supplier_id, api_url, schedule, last_run_at)
audit_log (id, org, action, actor, target, created_at)
```

### 3.3 Per-tenant repo 結構（自動建立）

```
scope3-inventory/
├── config.yml                    # 管理者設定
├── data/
│   ├── emission-factors.json     # 排放係數資料庫（版本化）
│   └── submissions.json          # 已核定資料彙整（Actions 維護）
├── reports/                      # 產出的報告
├── .github/
│   └── workflows/
│       ├── validate.yml          # 提交時驗證
│       ├── calculate.yml         # 核定後計算排放量
│       └── report.yml            # 定期產出報告
└── docs/                         # GitHub Pages 儀表板
```

---

## 4. 供應商資料入口（三管道）

| 管道 | 觸發方 | 流程 |
|------|--------|------|
| **Web Form** | 供應商（無需 GitHub 帳號）| 管理者產生專屬 URL → 供應商填表 → Worker 建立 Issue |
| **Push API** | 供應商主動推送 | 供應商以 Bearer token POST 到 Worker → 建立 Issue |
| **Pull Job** | 系統排程主動拉取 | Cloudflare Queues 排程呼叫供應商 API → 建立 Issue |

### 供應商 Token 機制

管理者在 `config.yml` 新增供應商後，Worker 自動：
1. 在 Cloudflare D1 產生 `supplier_token`（綁定 org + supplier_id + 有效期）
2. 寄送 onboarding email，含 Web Form URL、Push API 說明、Pull API 授權請求

---

## 5. 核心流程

```
ESG 公司安裝 GitHub App
        ↓
App 在其 org 自動建立 scope3-inventory repo
（含預設 Labels、Projects 看板、Actions、Pages）
        ↓
ESG Manager 編輯 config.yml（選類別、填供應商清單）
        ↓
push → Actions 觸發 → Worker 為每個供應商發送邀請 email
        ↓
供應商透過三種管道提交資料（建立 GitHub Issue）
        ↓
Actions 執行驗證（單位、異常值、缺件偵測）
        ↓
Reviewer 在 Projects 看板審核
（可補件 → Revision Required / 退件 → Rejected / 核定 → Approved）
        ↓
核定 → Actions 計算排放量 → 更新 submissions.json
        ↓
GitHub Pages 儀表板即時更新
        ↓
定期 / 手動觸發 → 產出 Excel / PDF 報告 → GitHub Releases
```

---

## 6. 資料模型

### 6.1 GitHub Issue = 一筆提交

每個 Issue body 為結構化 JSON（`<!-- scope3-data: {...} -->`）：

```json
{
  "submission_id": "uuid-v4",
  "supplier_id": "SUP001",
  "supplier_name": "台灣鋼鐵股份有限公司",
  "scope3_category": 1,
  "period": "2025-Q1",
  "activity_type": "electricity",
  "amount": 10000,
  "unit": "kWh",
  "evidence_urls": ["https://..."],
  "submitted_at": "2025-05-25T08:00:00Z",
  "channel": "form",
  "emission_factor_id": null,
  "calculated_co2e": null
}
```

### 6.2 Emission Factor（`data/emission-factors.json`）

```json
{
  "factor_id": "TW_ELEC_2025",
  "source": "Taiwan EPA",
  "year": 2025,
  "activity_type": "electricity",
  "value": 0.509,
  "unit": "kgCO2e/kWh",
  "region": "TW",
  "version": "v1.0.0"
}
```

支援來源：台灣環境部、IPCC、DEFRA、ecoinvent、IEA、自訂係數。

### 6.3 Submission 彙整（`data/submissions.json`）

Actions 核定後更新，作為儀表板與報告的資料來源：

```json
{
  "submission_id": "uuid-v4",
  "supplier_id": "SUP001",
  "scope3_category": 1,
  "period": "2025-Q1",
  "activity_type": "electricity",
  "amount": 10000,
  "unit": "kWh",
  "emission_factor_id": "TW_ELEC_2025",
  "calculated_co2e": 5090,
  "approved_at": "2025-06-01T10:00:00Z",
  "issue_number": 42
}
```

---

## 7. 審核工作流程

GitHub Labels 追蹤狀態：

| 狀態 | Label | 說明 |
|------|-------|------|
| Draft | `status:draft` | 供應商填寫中（Web Form 未送出）|
| Submitted | `status:submitted` | 已提交，等待審核 |
| Under Review | `status:reviewing` | 盤查員已接手 |
| Revision Required | `status:revision` | 退件補件，通知供應商 |
| Approved | `status:approved` | 核定，觸發計算 Actions |
| Archived | `status:archived` | 歸檔 |

另有類別 Labels：`cat:1`～`cat:15`，對應 15 個 Scope 3 類別。

**GitHub Projects 看板**：欄位對應狀態，盤查員以拖曳卡片推進狀態，觸發 webhook → Actions。

---

## 8. 驗證引擎（GitHub Actions）

提交建立 Issue 後，Actions 自動執行：

| 驗證類型 | 說明 | 範例 |
|----------|------|------|
| Unit Validation | 活動類型與單位是否合法 | Natural Gas 不允許 kg |
| Outlier Detection | 與歷史資料比較 | 今年用電超過去年 1000% |
| Missing Document | 必要佐證文件是否上傳 | 缺少電費單 |
| OCR Cross-check（Phase 2）| OCR 讀取文件數值 vs 填寫數值 | 電費單 OCR=10234，填寫=5000 |

驗證失敗自動在 Issue 留言說明，標記 `validation:warning` 或 `validation:error`。

---

## 9. 計算引擎（GitHub Actions）

Label 變更為 `status:approved` → 觸發 `calculate.yml`：

1. 讀取 Issue JSON
2. 查 `data/emission-factors.json` 匹配係數（activity_type + region + year）
3. `co2e = amount × factor.value`（含單位轉換）
4. 回寫計算結果至 Issue comment
5. Append 到 `data/submissions.json` 並 commit

---

## 10. 管理者設定（`config.yml`）

```yaml
inventory_year: 2025
enabled_categories: [1, 3, 4, 6, 7, 11]   # 管理者勾選

suppliers:
  - id: SUP001
    name: 台灣鋼鐵股份有限公司
    contact: esg@twsteel.com
    pull_api: https://api.twsteel.com/esg/scope3
    pull_schedule: "0 9 * * 1"              # 每週一 09:00

  - id: SUP002
    name: 台達電子工業股份有限公司
    contact: carbon@delta.com.tw
    pull_api: null                           # 僅使用 Form / Push
```

---

## 11. RBAC

| 資源 | Supplier | Reviewer | ESG Manager | Auditor | Admin |
|------|----------|----------|-------------|---------|-------|
| 自己的 Submission | RW | R | R | R | RW |
| 所有 Submissions | - | R | RW | R | RW |
| Emission Factors | - | R | RW | R | RW |
| config.yml | - | - | RW | R | RW |
| Reports | - | R | RW | R | RW |
| System Settings（D1）| - | - | - | - | RW |

---

## 12. 儀表板（GitHub Pages）

| KPI | 說明 |
|-----|------|
| Total Scope 3 | tCO₂e 合計 |
| Supplier Completion Rate | 已提交 / 已邀請 |
| Top Emission Suppliers | 排放前 10 供應商 |
| Emission by Category | 各類別佔比 |
| Submission Status | 各狀態數量 |
| Hotspot Analysis | 排放熱點視覺化 |

資料來源：`data/submissions.json`，靜態網頁，Actions 更新後自動重新部署。

---

## 13. 報表輸出

GitHub Actions 定期或手動觸發，產出後上傳至 GitHub Releases：

| 格式 | 說明 |
|------|------|
| Excel | 原始資料 + 計算結果 |
| PDF | 給審計方的正式報告 |
| CSV | 給 ERP / ESG 系統匯入 |
| GHG Protocol 格式 | 標準 Scope 3 報告 |
| IFRS S2 格式（Phase 2）| 氣候相關財務揭露 |

---

## 14. 稽核需求

保留期限至少 7 年，透過：

- **GitHub Issue 歷史**：所有留言、狀態變更、核定紀錄不可刪除
- **Git commit 歷史**：`data/submissions.json` 每次更新有完整 commit
- **Cloudflare D1 audit_log**：API 呼叫、token 使用記錄
- **GitHub Actions log**：計算過程完整留存

---

## 15. 安全性

- **供應商認證**：Token URL（短期有效，可撤銷）、Push API Bearer token
- **内部認證**：GitHub OAuth（SSO、MFA 由 GitHub 負責）
- **傳輸加密**：HTTPS（Cloudflare + GitHub）
- **靜態加密**：GitHub repo（客戶自控）
- **文件病毒掃描**（Phase 2）：上傳佐證文件時掃描
- **RBAC**：如第 11 節定義

---

## 16. AI 功能（Phase 2）

| 功能 | 實作方式 |
|------|----------|
| OCR | Azure Document Intelligence，辨識電費單、發票、EPD |
| AI Validation | 異常值檢測、單位修正建議、缺件提醒 |
| AI Assistant | 供應商可詢問如何填寫、單位換算、需要哪些文件 |
| File Classification | 自動分類上傳文件類型 |

---

## 17. MVP（Phase 1）

### 必要功能

**供應商端**
- Web Form（Email OTP 驗證、Draft 存檔、送出）
- Push API

**ESG Manager 端**
- 安裝 App → 自動建立 repo
- 編輯 `config.yml` 設定類別與供應商
- 觸發邀請 email

**Reviewer 端**
- GitHub Projects 看板審核
- Issue 留言補件/退件/核定

**計算**
- 排放係數 mapping
- Scope 3 計算
- 更新 `submissions.json`

**報告**
- GitHub Pages 儀表板
- Excel / PDF 輸出

---

## 18. Roadmap

### Phase 1（MVP）
核心工作流程：安裝、邀請供應商、提交、審核、計算、報告

### Phase 2
- OCR + AI Validation
- Excel 批次匯入
- ERP API Connector
- IFRS S2 報告格式
- 文件病毒掃描

### Phase 3
- Product Carbon Footprint（PCF）
- CBAM 申報支援
- Digital Product Passport
- Supplier Benchmarking
- Decarbonization Planning

---

## 19. 成功指標

| 指標 | 目標 |
|------|------|
| 供應商完成率 | > 80% |
| 文件缺件率 | < 10% |
| 審核時間 | < 5 days |
| 異常值偵測率（Phase 2）| > 90% |
| API 成功率 | > 99.9% |

---

## 20. 設計原則

- **P1. 供應商友善**：無需 GitHub 帳號，UI 簡單，可草稿，支援 AI 協助
- **P2. Audit-first**：所有資料可追溯，不可竄改
- **P3. Factor Governance**：排放係數版本化，來源可查
- **P4. API-first**：所有功能可 API 化
- **P5. GitHub-native**：充分利用 GitHub 生態（Issues、Actions、Pages、Releases）
- **P6. 資料主權**：盤點資料存在客戶自己的 repo，我們的基礎設施不碰業務資料

---

## 21. 非目標（v1 不做）

- 完整 LCA Engine
- ERP 替代
- ESG 財報排版
- 碳交易平台
- 獨立 Frontend（不用 Next.js，以 GitHub Pages 取代）
- 自架資料庫（不用 PostgreSQL，以 GitHub repo 檔案取代）
