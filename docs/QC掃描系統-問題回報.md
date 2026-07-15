# 給 QC 安全掃描系統的問題回報

> **對象**：QC 掃描系統（自稱 "System Integration Quality Control"）的維護者
> **回報者**：agent.scope3esg 專案
> **依據**：Scan ID `20260714-231447-1fcb`（2026-07-14 23:20:11）的五份報告
> **回報日**：2026-07-15
>
> 本專案端該修的已全部修完（見文末）。以下是**掃描系統本身**的問題，我們這邊改不到，
> 提供證據與建議修法供評估。每項都附可自行復現的驗證方式。

---

## P1-1 ｜ ZAP scan scope 未限制，跟著 302 爬到 github.com

**影響**：4 類誤報 + 整份 SEO 報告失效。這是本次報告最大的雜訊來源。

**症狀**：掃描目標設為 `https://scope3-worker.lightman-chang.workers.dev/admin/yao-care`，
但該路徑未登入時會 302 導向 GitHub OAuth。掃描器跟著跳到 `github.com`，
**把 GitHub 登入頁的問題記在我方 URL 名下**。

**證據**：

1. seo-report.html 抓到的 meta 根本是 GitHub 的：
   - `title: Sign in to GitHub · GitHub`
   - `og:url: https://github.com`
   - `og:image: https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png`
   - 「45 個腳本使用 async/defer」— 我方頁面沒有 45 個腳本

2. pentest-report.html 由此產生的誤報：

   | 報告項目 | 實際情況 |
   |----------|----------|
   | Cookie No HttpOnly Flag ×1 | 我方 session cookie 一直都是 `HttpOnly; Secure; SameSite=Lax`（`scope3-worker/src/routes/admin.ts`）。ZAP 抓到的是 GitHub 的 cookie |
   | Cross-Domain JavaScript Source File Inclusion ×5 | GitHub 登入頁的 JS |
   | Timestamp Disclosure - Unix ×1 | 實測我方回應中**零個 10 位數字**（見下方復現指令）；OAuth state 是 base64url(JSON)，payload 僅 `{org, nonce}`、無 timestamp |
   | Sub Resource Integrity Missing ×5 | 同為 GitHub 頁面的 script |

**復現**：
```bash
curl -s -D - https://scope3-worker.lightman-chang.workers.dev/admin/yao-care | grep -oE "[0-9]{10}"
# 無輸出 → 我方回應不含 unix timestamp
```

**建議修法**：ZAP 的 spider/scan scope 限制在目標 host，例如
`-config spider.scope=scope3-worker.lightman-chang.workers.dev`
或 context 只納入 `https://scope3-worker\.lightman-chang\.workers\.dev.*`。
一次解決上述全部 + SEO 報告。

**請勿以 rules.tsv IGNORE 代替**：`10010 (Cookie No HttpOnly)` 一旦 IGNORE，
未來真的掉了 HttpOnly 也不會再報。用抑制規則蓋掉「掃錯目標」是拿真實防護換報告好看。

---

## P1-2 ｜ Quality Gate 把 Semgrep `[WARNING]` 當成 High

**影響**：本次 Gate FAIL 的 15 個 High **有 14 個是這樣來的**。

**證據**：agent.scope3esg-report.html 的 SAST 區塊，14 條原始輸出**全部**是 `[WARNING]`
開頭（無一 ERROR）；但 compliance-report.html 的 A.8.28 那列記為 `C:0 H:14 M:0 L:0`，
scan-report.html 的 Quality Gate 卡片顯示 `High 15`（= SAST 14 + Trivy 1）。

**後果**：門檻長期被雜訊綁架。本次那 14 條（Actions 未 pin SHA）確實值得修、我方也修了，
但同樣的映射會讓任何一批 WARNING 級建議都能把 Gate 打 FAIL，久了就會被無視。

**建議修法**：`quality-gate.json` 的嚴重度映射改為
`Semgrep ERROR → High`、`WARNING → Medium`、`INFO → Low`，
或至少讓 Gate 只看 Semgrep ERROR 與 Trivy Critical/High。

---

## P2-1 ｜ SSDLC「0/0」被 compliance 記為 PASS

**證據**：agent.scope3esg-report.html 的 SSDLC 表格 **tbody 完全空白**，
摘要卡片 `0/0`；但 compliance-report.html 的 A.8.25 那列記為
`PASS`（`Pass:0 Fail:0 Warn:0`）。

**問題**：一項檢查都沒跑，不應等同通過。這會讓 ISO 27001 A.8.25 的合規證據失真。

**建議修法**：檢查項為 0 時應回報 `N/A` 或 `NOT_RUN`，不可記 PASS。
另請確認 `ssdlc.sh` 為何對本專案產出 0 個檢查項。

---

## P2-2 ｜ compliance 報告的統計數字自相矛盾

**證據**（同一份 compliance-report.html 內）：
- 摘要卡片：`PASS 10 / PARTIAL 2 / FAIL 4 / N/A 5` = **21 項**
- Policy Compliance（A.5.36）那列：`Pass:2 Partial:2 Fail:3 N/A:2` = **9 項**

兩者應描述同一組控制項，但總數與分佈都對不上。

**建議修法**：確認 aggregate 的計數範圍（是否漏算 Runtime 監控那 7 項、
或 Policy Compliance 只統計了部分 scanner）。

---

## P2-3 ｜ SBOM 元件分類全歸零

**證據**：agent.scope3esg-report.html 的 SBOM 區塊：
`Total Components: 314`、`Node.js: 0`、`Python: 0`。

**問題**：本專案是純 Node/TypeScript（pnpm workspace，`scope3-worker/package.json`），
314 個元件不可能有 0 個 Node.js。分類邏輯疑似未涵蓋 pnpm lockfile 格式。

**建議修法**：確認 SBOM 產生器是否支援 `pnpm-lock.yaml`（v10 格式），
或分類時是否只認 `package-lock.json` / `yarn.lock`。

---

## P3-1 ｜ compliance 的 ISMS 政策文件連結指向不存在的目錄

**證據**：compliance-report.html 的「政策文件 Policy Documents」區塊，
HTML 註解寫著：
```html
<!-- ISMS 文件已遷移至 isms/ 目錄，請參閱版本庫中的 isms/procedures/ 及 isms/policies/ -->
```
但列出的 10 個項目（資訊安全政策、PRO-001/002/003、AI 治理政策等）全部是
`<span>` 而非 `<a>`，且 **agent.scope3esg 與其他所有 yao.care 專案都沒有 `isms/` 目錄**
（已於 2026-07-15 全機確認）。

**建議修法**：確認 ISMS 文件的實際位置。若在掃描系統自己的版本庫，
報告應指向該處的可用連結；若確實未建立，該區塊應標示為缺漏而非列出無連結項目。

---

## P3-2 ｜ SEO/AEO 掃描不適用於本專案，建議移出 pipeline

**理由**：agent.scope3esg 是 B2B 內部工具——`/admin/*` 需 GitHub OAuth 登入、
`/submit/*` 需 token，**無任何公開內容**。SEO 總分 36%、SGE 0/5、E-E-A-T 0/6
對它沒有意義（何況本次掃到的還是 GitHub 登入頁，見 P1-1）。

另：本專案已於 2026-07-15 起由 Worker 提供 `robots.txt` 回 `Disallow: /`
（commit `b63065e`），明確表示不希望被索引。

**建議修法**：將 SEO/AEO 掃描設為 per-project 可關閉，並對本專案關閉。

---

## 附記：一個容易誤判的平台行為（非掃描系統的錯）

ZAP 對 `/robots.txt` 報 `X-Content-Type-Options Missing` **是真的**，但根因是
Cloudflare workers.dev 由**平台層**直接回應 robots.txt（content-signals 樣板），
該回應不經過 Worker，因此拿不到我方的安全標頭。

我方已於 commit `b63065e` 讓 Worker 自行接管 `/robots.txt` 解決。
記錄於此供其他 workers.dev 專案參考——同類專案很可能有相同現象。

---

## 我方（agent.scope3esg）已修項目

commits `e311664` → `565a60b` → `301f04e` → `4154fee` → `b63065e`，皆已部署並線上驗證。

| 報告項目 | 修法 |
|----------|------|
| Trivy 1 High + 5 Medium | hono 4.12.23→4.12.30（CVE-2026-54290 等 5 項）、js-yaml 4.1.1→4.3.0（CVE-2026-53550） |
| SAST 14 WARNING | 14 處 GitHub Actions 全 pin 至 40 字元 commit SHA |
| ZAP HSTS ×5 | 新增，全回應套用 |
| ZAP COEP / COOP / CORP ×4 | 新增，全回應套用 |
| ZAP Permissions-Policy ×1 | 新增 |
| ZAP X-Content-Type-Options（robots.txt）×1 | Worker 接管 robots.txt |
| ZAP Storable and Cacheable ×4、Re-examine Cache-control ×2 | HTML 加 `Cache-Control: no-store`（靜態資源維持可快取） |

**預期下次掃描**：Critical 0、High **15 → 0**、Quality Gate 轉 PASS。

驗證方式：
```bash
curl -sI https://scope3-worker.lightman-chang.workers.dev/health | grep -iE "strict-transport|cross-origin|permissions-policy|x-content-type"
curl -s https://scope3-worker.lightman-chang.workers.dev/robots.txt
```

若 P1-1、P1-2 未修，下次報告仍會出現上述誤報，且 Gate 仍可能被 WARNING 級發現打 FAIL。
