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
<style>
  body { font-family: sans-serif; max-width: 640px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 1.4rem; color: #1a1a1a; }
  label { display: block; margin: 16px 0 4px; font-weight: bold; font-size: .9rem; }
  input, select { width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  .row { display: flex; gap: 12px; }
  .row > * { flex: 1; }
  button { margin-top: 24px; padding: 12px 32px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
  .supplier { color: #555; font-size: .9rem; margin-bottom: 24px; }
</style>
</head>
<body>
<h1>Scope 3 碳排資料提交</h1>
<p class="supplier">供應商：<strong>${supplierId}</strong></p>
<form method="POST" enctype="multipart/form-data">
  <label>盤點類別 (Scope 3 Category)</label>
  <select name="scope3_category" required>
    ${Array.from({length:15},(_,i)=>`<option value="${i+1}">Category ${i+1}</option>`).join('')}
  </select>

  <label>期間（例：2025-Q1）</label>
  <input name="period" placeholder="2025-Q1" required pattern="\\d{4}-Q[1-4]">

  <label>活動類型</label>
  <select name="activity_type" required>
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
      <label>數量</label>
      <input name="amount" type="number" step="any" required>
    </div>
    <div>
      <label>單位</label>
      <select name="unit" required>
        <option value="kWh">kWh</option>
        <option value="Nm3">Nm3</option>
        <option value="L">公升 (L)</option>
        <option value="ton">公噸 (ton)</option>
        <option value="kg">公斤 (kg)</option>
        <option value="pcs">件 (pcs)</option>
        <option value="km">公里 (km)</option>
      </select>
    </div>
  </div>

  <label>佐證文件（可多選，最大 10MB/檔）</label>
  <input name="files" type="file" multiple accept=".pdf,.xlsx,.csv,.jpg,.png">

  <button type="submit">提交資料</button>
</form>
</body>
</html>`;
}

function successHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><title>提交成功</title>
<style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;}
h1{color:#0e8a16;}p{color:#555;}</style></head>
<body><h1>✅ 提交成功</h1>
<p>資料已收到，審查人員將在 5 個工作天內完成審核。</p>
<p>感謝您的配合。</p></body></html>`;
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
    if (file.size === 0) continue;
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
