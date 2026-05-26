# Scope 3 GitHub App — 統一設計系統

## 1. 目的

消除目前各頁面（admin 管理頁、供應商填表頁、提交成功頁、GitHub Pages 儀表板）各自為政的 inline CSS，改為**單一 CSS 來源**：固定 oklch 配色、統一字級規範、共用元件樣式。改一處即全站更新。

## 2. 架構：單一來源 + 兩個輸出管道

**單一來源**：`src/ui/theme.mjs` export 一份完整 CSS 字串 `APP_CSS`（含 `:root` design tokens 與元件 class）。這是全站樣式的唯一事實來源。**用 `.mjs`（純 JS，無相依）而非 `.ts`**，因為 `build-templates.mjs` 由 Node 直接執行、無法 import `.ts`；而 Worker（esbuild）也能 import `.mjs`，兩端共用同一檔。

**輸出管道**：
1. **Worker 頁面**（admin / 填表 / 成功頁，皆由 Worker 服務）：新增 `GET /assets/app.css` 路由回傳 `APP_CSS`（`Content-Type: text/css`，含 cache header）。各頁 HTML 改用 `<link rel="stylesheet" href="/assets/app.css">`，移除各自 inline `<style>`。
2. **儀表板**（租戶 repo `docs/`，由 GitHub Pages 服務、不經 Worker）：`scripts/build-templates.mjs` 在打包時把 `APP_CSS` 寫入 `tenant-template/docs/app.css`，儀表板 `docs/index.html` 改用 `<link rel="stylesheet" href="./app.css">`。

結果：修改 `src/ui/theme.ts` → Worker 頁面立即生效（部署後）；儀表板於 `build-templates` + 部署 + Pages 重新部署後生效。

> 注意：`theme.mjs` 需能被 Node（build-templates）與 Worker 同時 import。它只 export 純字串常數，無相依，兩端皆可用。Worker 端 `.ts` 檔 import `.mjs` 時，esbuild 正常打包；tsc 若對缺型別宣告有警告不影響執行。

## 3. oklch 配色（`:root` 變數）

```css
--bg:        oklch(0.985 0.004 250);  /* 頁背景 淺灰藍 */
--surface:   oklch(1 0 0);            /* 卡片 白 */
--fg:        oklch(0.27 0.02 255);    /* 主文字 深藍灰 */
--muted:     oklch(0.55 0.02 255);    /* 次要文字 */
--border:    oklch(0.92 0.008 255);   /* 邊框 */
--primary:     oklch(0.58 0.17 256);  /* 主按鈕 藍 */
--primary-fg:  oklch(0.99 0 0);       /* 主按鈕文字 */
--primary-weak:oklch(0.95 0.03 256);  /* 主色淺底（bar/hover）*/
--danger:      oklch(0.57 0.19 27);   /* 刪除 紅 */
--success:     oklch(0.60 0.14 150);  /* 成功 綠 */
--warning:     oklch(0.75 0.15 85);   /* 警告 黃 */
```

## 4. 字級與基礎變數（`:root`）

```css
--font:        -apple-system, "Segoe UI", "Noto Sans TC", sans-serif;
--text-xs:.78rem; --text-sm:.88rem; --text-base:1rem; --text-lg:1.15rem; --text-xl:1.4rem;
--leading: 1.5;
--radius: 8px;
--gap: 16px;
```

字級套用原則：頁標題用 `--text-xl`、區塊標題 `--text-lg`、內文 `--text-base`、表格/標籤 `--text-sm`、輔助說明 `--text-xs`。

## 5. 元件 class（共用）

- `.card` — 白底圓角卡片區塊（取代各頁的 `section`）
- `.btn` + 變體 `.btn-primary` / `.btn-secondary` / `.btn-danger`
- `.input` / `.select` — 表單欄位
- `.table` — 表格（含表頭、列分隔）
- `.label` — 欄位標籤
- `.badge` — 狀態標籤（提交狀態用，依 status 著色）
- `.muted` — 次要文字
- `.bar-track` / `.bar-fill` — 儀表板長條圖

## 6. 要重構套用的頁面

| 頁面 | 檔案 | 動作 |
|------|------|------|
| 管理介面 | `src/admin/page.ts` | 移除 inline `<style>`，改 link `/assets/app.css`，class 換成共用 class |
| 供應商填表頁 + 成功頁 | `src/routes/submit.ts` | 同上 |
| 儀表板 | `tenant-template/docs/index.html` | 移除 inline `<style>`，改 link `./app.css` |
| CSS 來源 | `src/ui/theme.mjs`（新） | export `APP_CSS` |
| CSS 路由 | `src/routes/assets.ts`（新） | `GET /assets/app.css` |
| 打包 | `scripts/build-templates.mjs` | 額外輸出 `tenant-template/docs/app.css` |

## 7. 測試

- `GET /assets/app.css` 回 200、`Content-Type: text/css`、內容含 `:root` 與 `--primary`（路由測試，Cloudflare pool）。
- `build-templates` 後 `tenant-template/docs/app.css` 存在且內容等於 `APP_CSS`（可用 node 檢查；或在 build 腳本 console 確認）。
- 既有頁面路由（`/submit/:org/:token` GET、`/admin/:org` 導向）仍正常回應（既有測試不破壞）。

## 8. 非目標

- 不引入 CSS 框架（Tailwind 等）或 build step（PostCSS）——維持 vanilla、零相依。
- 不做深色模式（先單一淺色主題；oklch 變數已為未來深色預留彈性）。
- 不改頁面的功能行為，只改視覺與樣式來源。

## 9. CLAUDE.md 規則協調

全域 CLAUDE.md「圖表規則」寫「Mermaid 色彩用 hex，不用 oklch()」——該規則針對 **Mermaid 圖表**。本設計系統的 oklch 僅用於 **HTML 頁面 CSS**，與 Mermaid 無關。實作時於專案 `CLAUDE.md` 補一行註明：HTML 頁面 CSS 用 oklch（design tokens），Mermaid 圖表仍用 hex。
