# Scope 3 ESG Carbon Data Governance Platform

多租戶 GitHub App。ESG 公司安裝之後，會自動在它自己的 organization 底下建立一個 `scope3-inventory` repo，用來盤點 Scope 3 碳排。

## 為什麼做成 GitHub App

Scope 3 的盤查資料需要版本控制、需要留審計軌跡、需要多人協作審閱。這些事 git 本來就在做。把盤查表放進客戶自己的 repo，資料留在客戶手上，變更歷程天然可稽核，不需要另外做一套權限與版控系統。

## 架構

- `scope3-worker/` — 主程式，跑在 Cloudflare Workers
- `docs/` — 文件
- `.github/` — CI

多租戶：一次部署，服務所有安裝這個 App 的 organization。

## 技術

Cloudflare Workers、GitHub App（webhook 加 installation token）。

---

Maintained by Light. I build and maintain websites with AI as a service: [arthurs.tw](https://arthurs.tw/?utm_source=github&utm_medium=readme&utm_campaign=oss)
