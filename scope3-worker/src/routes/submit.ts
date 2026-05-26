import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getSupplierToken } from '../db/queries';
import { processSubmission } from '../handlers/submission';

const submit = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function formHtml(org: string, token: string, supplierId: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 碳排資料提交</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="container">
<h1>Scope 3 碳排資料提交</h1>
<p class="supplier-note">供應商：<strong>${supplierId}</strong></p>
<form method="POST" enctype="multipart/form-data">
  <label class="label">盤點類別 (Scope 3 Category)</label>
  <select class="select" name="scope3_category" required>
    ${Array.from({length:15},(_,i)=>`<option value="${i+1}">Category ${i+1}</option>`).join('')}
  </select>

  <label class="label">期間（例：2025-Q1）</label>
  <input class="input" name="period" placeholder="2025-Q1" required pattern="\\d{4}-Q[1-4]">

  <label class="label">活動類型</label>
  <select class="select" name="activity_type" id="activity_type" required>
    <option value="electricity">電力 (Electricity)</option>
    <option value="natural_gas">天然氣 (Natural Gas)</option>
    <option value="diesel">柴油 (Diesel)</option>
    <option value="water">用水 (Water)</option>
    <option value="waste">廢棄物 (Waste)</option>
    <option value="product">產品 (Product)</option>
    <option value="transport">運輸 (Transport)</option>
  </select>

  <div class="row">
    <div>
      <label class="label">數量</label>
      <input class="input" name="amount" type="number" step="any" required>
    </div>
    <div>
      <label class="label">單位</label>
      <select class="select" name="unit" id="unit" required></select>
    </div>
  </div>

  <label class="label">佐證文件（可多選，最大 10MB/檔）</label>
  <input class="input" name="files" type="file" multiple accept=".pdf,.xlsx,.csv,.jpg,.png">

  <button class="btn btn-primary btn-lg" type="submit">提交資料</button>
</form>
<script>
  // 單位選項依活動類型連動，須與後端 lib.mjs 的 UNIT_RULES 一致，
  // 避免供應商提交無法計算的單位組合。以字串拼接避免與 server 端 template literal 衝突。
  var ACTIVITY_UNITS = {
    electricity: [['kWh', 'kWh']],
    natural_gas: [['Nm3', 'Nm3']],
    diesel:      [['L', '公升 (L)']],
    water:       [['ton', '公噸 (ton)']],
    waste:       [['ton', '公噸 (ton)'], ['kg', '公斤 (kg)']],
    product:     [['pcs', '件 (pcs)'], ['kg', '公斤 (kg)'], ['ton', '公噸 (ton)']],
    transport:   [['km', '公里 (km)']]
  };
  var actEl = document.getElementById('activity_type');
  var unitEl = document.getElementById('unit');
  function syncUnits() {
    var opts = ACTIVITY_UNITS[actEl.value] || [];
    unitEl.innerHTML = opts.map(function (o) {
      return '<option value="' + o[0] + '">' + o[1] + '</option>';
    }).join('');
  }
  actEl.addEventListener('change', syncUnits);
  syncUnits();
</script>
</div>
</body>
</html>`;
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>提交成功</title>
<link rel="stylesheet" href="/assets/app.css"></head>
<body><div class="container"><div class="success-box"><h1>✅ 提交成功</h1>
<p>資料已收到，審查人員將在 5 個工作天內完成審核。</p>
<p>感謝您的配合。</p></div></div></body></html>`;
}

submit.get('/:org/:token', async (c) => {
  const { org, token } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) {
    return c.text('無效的連結', 401);
  }
  return c.html(formHtml(org, token, tokenRow.supplierId));
});

submit.post('/:org/:token', async (c) => {
  const { org, token } = c.req.param();

  const formData = await c.req.formData();

  const evidenceUrls: string[] = [];
  const files = formData.getAll('files') as unknown as File[];
  for (const file of files) {
    // 斷言為 File[]，但未選檔時 getAll 實際可能回傳空字串；以 runtime 檢查排除非檔案。
    if (typeof file?.size !== 'number' || file.size === 0) continue;
    const ext = file.name.split('.').pop() ?? 'bin';
    const key = `${org}/${crypto.randomUUID()}.${ext}`;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
    });
    evidenceUrls.push(`${c.env.WORKER_BASE_URL}/files/${key}`);
  }

  const result = await processSubmission(c.env, {
    org,
    supplierToken: token,
    data: {
      scope3_category: Number(formData.get('scope3_category')),
      period:          String(formData.get('period')),
      activity_type:   String(formData.get('activity_type')),
      amount:          Number(formData.get('amount')),
      unit:            String(formData.get('unit')),
      evidence_urls:   evidenceUrls,
    },
    channel: 'form',
  });

  if (!result.success) {
    return c.text(result.error ?? '提交失敗', 400);
  }

  return c.html(successHtml());
});

export default submit;
