import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { getSupplierToken, getTenantByOrg } from '../db/queries';
import { processSubmission } from '../handlers/submission';
import { getInstallationOctokit } from '../github/app';
import {
  listSupplierSubmissions,
  listOpenPullRequestsByPrefix,
  getLatestRejectReason,
  closePullRequest,
  deleteBranch,
  getMainSha,
  createBranch,
  getFileSha,
  deleteFileViaBranch,
  openPullRequest,
  getFileOnBranch,
  updateFileOnBranch,
  removeLabelFromPR,
} from '../github/pr';

const submit = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function esc(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formHtml(
  org: string,
  token: string,
  supplierId: string,
  approved: Record<string, unknown>[],
  pending: Array<{ number: number; title: string; submissionId: string | undefined; needsRevision: boolean; rejectReason: string | null; data: Record<string, unknown> | null }>,
  withdrawnIds: (string | undefined)[],
): string {
  const withdrawBtn = (sid: unknown) => `<form method="POST" action="/submit/${esc(org)}/${esc(token)}/withdraw" style="display:inline" onsubmit="return confirm('確定撤回此筆？')">
  <input type="hidden" name="submission_id" value="${esc(sid)}">
  <button class="btn btn-danger" type="submit">撤回</button>
</form>`;
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
<p class="supplier-note">供應商：<strong>${esc(supplierId)}</strong></p>
<section class="card">
  <h2>我的提交紀錄</h2>
  <table class="table">
    <thead><tr><th>期間</th><th>類別</th><th>活動</th><th>數量</th><th>狀態</th><th>操作</th></tr></thead>
    <tbody>
      ${pending.map((p) => { const d = (p.data || {}); return `<tr>
        <td>${esc(d.period)}</td><td>Cat.${esc(d.scope3_category)}</td><td>${esc(d.activity_type)}</td><td>${esc(d.amount)} ${esc(d.unit)}</td>
        <td>${p.needsRevision ? `<span class="badge">需修改</span>` : `<span class="badge">審核中</span>`}${p.needsRevision && p.rejectReason ? `<div class="muted">退件理由：${esc(p.rejectReason)}</div>` : ''}</td>
        <td>${p.submissionId ? `<a class="btn btn-secondary" href="/submit/${esc(org)}/${esc(token)}/edit/${esc(p.submissionId)}">編輯</a> ${withdrawBtn(p.submissionId)}` : ''}</td>
      </tr>`; }).join('')}
      ${approved.map((s) => {
        const isWithdrawing = withdrawnIds.indexOf(s.submission_id as string | undefined) >= 0;
        return `<tr><td>${esc(s.period)}</td><td>Cat.${esc(s.scope3_category)}</td><td>${esc(s.activity_type)}</td><td>${esc(s.amount)} ${esc(s.unit)}</td><td>${isWithdrawing ? '<span class="badge">撤回審核中</span>' : '<span class="badge">已核定</span>'}</td><td>${isWithdrawing ? '' : withdrawBtn(s.submission_id)}</td></tr>`;
      }).join('')}
      ${(pending.length === 0 && approved.length === 0) ? '<tr><td colspan="6" class="muted">尚無提交紀錄</td></tr>' : ''}
    </tbody>
  </table>
  <p class="muted">如需修改，請先撤回該筆，再於下方重新填寫提交。</p>
</section>
<section class="card">
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
</section>
</div>
</body>
</html>`;
}

function editFormHtml(org: string, token: string, supplierId: string, submissionId: string, data: Record<string, unknown>): string {
  const d = data as { scope3_category?: number; period?: string; activity_type?: string; amount?: number; unit?: string };
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>編輯提交</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><div class="container">
<h1>編輯提交</h1>
<p class="supplier-note">供應商：<strong>${esc(supplierId)}</strong>｜提交：${esc(submissionId)}</p>
<section class="card">
<form method="POST" action="/submit/${esc(org)}/${esc(token)}/edit/${esc(submissionId)}" enctype="multipart/form-data">
  <label class="label">盤點類別 (Scope 3 Category)</label>
  <select class="select" name="scope3_category" required>
    ${Array.from({length:15},(_,i)=>`<option value="${i+1}" ${Number(d.scope3_category)===i+1?'selected':''}>Category ${i+1}</option>`).join('')}
  </select>
  <label class="label">期間（例：2025-Q1）</label>
  <input class="input" name="period" value="${esc(d.period)}" required pattern="\\d{4}-Q[1-4]">
  <label class="label">活動類型</label>
  <select class="select" name="activity_type" id="activity_type" required>
    ${['electricity','natural_gas','diesel','water','waste','product','transport'].map((a)=>`<option value="${a}" ${d.activity_type===a?'selected':''}>${a}</option>`).join('')}
  </select>
  <div class="row">
    <div><label class="label">數量</label><input class="input" name="amount" type="number" step="any" value="${esc(d.amount)}" required></div>
    <div><label class="label">單位</label><select class="select" name="unit" id="unit" required></select></div>
  </div>
  <label class="label">補充佐證文件（可選；會附加到原佐證）</label>
  <input class="input" name="files" type="file" multiple accept=".pdf,.xlsx,.csv,.jpg,.png">
  <button class="btn btn-primary btn-lg" type="submit">更新並重新送審</button>
</form>
<p><a class="btn btn-secondary" href="/submit/${esc(org)}/${esc(token)}">取消，返回清單</a></p>
</section>
<script>
  var ACTIVITY_UNITS = { electricity:[['kWh','kWh']], natural_gas:[['Nm3','Nm3']], diesel:[['L','公升 (L)']], water:[['ton','公噸 (ton)']], waste:[['ton','公噸 (ton)'],['kg','公斤 (kg)']], product:[['pcs','件 (pcs)'],['kg','公斤 (kg)'],['ton','公噸 (ton)']], transport:[['km','公里 (km)']] };
  var actEl=document.getElementById('activity_type'), unitEl=document.getElementById('unit');
  var CUR_UNIT=${JSON.stringify(d.unit ?? '')};
  function syncUnits(){ var opts=ACTIVITY_UNITS[actEl.value]||[]; unitEl.innerHTML=opts.map(function(o){return '<option value="'+o[0]+'" '+(o[0]===CUR_UNIT?'selected':'')+'>'+o[1]+'</option>';}).join(''); }
  actEl.addEventListener('change', function(){ CUR_UNIT=''; syncUnits(); });
  syncUnits();
</script>
</div></body></html>`;
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

  let approved: Record<string, unknown>[] = [];
  let pending: Array<{ number: number; title: string; submissionId: string | undefined; needsRevision: boolean; rejectReason: string | null; data: Record<string, unknown> | null }> = [];
  let withdrawnIds: (string | undefined)[] = [];
  try {
    const tenant = await getTenantByOrg(c.env.DB, org);
    if (tenant) {
      const octokit = await getInstallationOctokit(c.env, tenant.installationId);
      approved = await listSupplierSubmissions(octokit, org, tokenRow.supplierId);
      const subPrs = await listOpenPullRequestsByPrefix(octokit, org, `sub/${tokenRow.supplierId}/`);
      pending = await Promise.all(subPrs.map(async (p) => {
        const submissionId = p.head.ref.split('/').pop();
        const needsRevision = p.labels.some((l) => l.name === 'status:revision');
        const rejectReason = needsRevision ? await getLatestRejectReason(octokit, org, p.number) : null;
        const file = await getFileOnBranch(octokit, org, p.head.ref, `submissions/${tokenRow.supplierId}/${submissionId}.json`);
        return { number: p.number, title: p.title, submissionId, needsRevision, rejectReason, data: file ? file.data : null };
      }));
      const wdPrs = await listOpenPullRequestsByPrefix(octokit, org, `withdraw/${tokenRow.supplierId}/`);
      withdrawnIds = wdPrs.map((p) => p.head.ref.split('/').pop());
    }
  } catch { /* 查不到清單不擋填表 */ }

  return c.html(formHtml(org, token, tokenRow.supplierId, approved, pending, withdrawnIds));
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

submit.post('/:org/:token/withdraw', async (c) => {
  const { org, token } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) return c.text('無效的連結', 401);
  const form = await c.req.formData();
  const submissionId = String(form.get('submission_id') ?? '');
  if (!submissionId) return c.text('缺少 submission_id', 400);

  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('租戶不存在', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const branch = `sub/${tokenRow.supplierId}/${submissionId}`;
  const path = `submissions/${tokenRow.supplierId}/${submissionId}.json`;

  // 未核定：有 open PR → 關 PR + 刪分支
  const prs = await listOpenPullRequestsByPrefix(octokit, org, branch);
  const exact = prs.find((p) => p.head.ref === branch);
  if (exact) {
    await closePullRequest(octokit, org, exact.number);
    await deleteBranch(octokit, org, branch).catch(() => {});
    return c.redirect(`/submit/${org}/${token}`);
  }

  // 已核定：開分支刪 main 檔 + 開撤回 PR（需盤查員 merge 才生效）
  const sha = await getFileSha(octokit, org, path);
  if (sha) {
    const wbranch = `withdraw/${tokenRow.supplierId}/${submissionId}`;
    const mainSha = await getMainSha(octokit, org);
    await createBranch(octokit, org, wbranch, mainSha);
    await deleteFileViaBranch(octokit, org, wbranch, path, sha, `withdraw: ${tokenRow.supplierId} ${submissionId}`);
    await openPullRequest(octokit, org, wbranch, `[撤回] ${tokenRow.supplierId} ${submissionId}`, '供應商要求撤回此筆已核定提交，請盤查員確認後 merge。');
  }
  return c.redirect(`/submit/${org}/${token}`);
});

submit.get('/:org/:token/edit/:submissionId', async (c) => {
  const { org, token, submissionId } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) return c.text('無效的連結', 401);
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('租戶不存在', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const branch = `sub/${tokenRow.supplierId}/${submissionId}`;
  const path = `submissions/${tokenRow.supplierId}/${submissionId}.json`;
  const file = await getFileOnBranch(octokit, org, branch, path);
  if (!file) return c.text('找不到可編輯的提交（可能已核定或不存在）', 404);
  return c.html(editFormHtml(org, token, tokenRow.supplierId, submissionId, file.data));
});

submit.post('/:org/:token/edit/:submissionId', async (c) => {
  const { org, token, submissionId } = c.req.param();
  const tokenRow = await getSupplierToken(c.env.DB, token);
  if (!tokenRow || tokenRow.org !== org) return c.text('無效的連結', 401);
  const tenant = await getTenantByOrg(c.env.DB, org);
  if (!tenant) return c.text('租戶不存在', 404);
  const octokit = await getInstallationOctokit(c.env, tenant.installationId);
  const branch = `sub/${tokenRow.supplierId}/${submissionId}`;
  const path = `submissions/${tokenRow.supplierId}/${submissionId}.json`;

  const file = await getFileOnBranch(octokit, org, branch, path);
  if (!file) return c.text('找不到可編輯的提交', 404);

  const formData = await c.req.formData();
  const evidenceUrls: string[] = Array.isArray((file.data as { evidence_urls?: string[] }).evidence_urls)
    ? [...((file.data as { evidence_urls: string[] }).evidence_urls)] : [];
  const files = formData.getAll('files') as unknown as File[];
  for (const f of files) {
    if (typeof f?.size !== 'number' || f.size === 0) continue;
    const ext = f.name.split('.').pop() ?? 'bin';
    const key = `${org}/${crypto.randomUUID()}.${ext}`;
    await c.env.FILES.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
    evidenceUrls.push(`${c.env.WORKER_BASE_URL}/files/${key}`);
  }

  const updated = {
    ...file.data,
    scope3_category: Number(formData.get('scope3_category')),
    period: String(formData.get('period')),
    activity_type: String(formData.get('activity_type')),
    amount: Number(formData.get('amount')),
    unit: String(formData.get('unit')),
    evidence_urls: evidenceUrls,
  };
  await updateFileOnBranch(octokit, org, branch, path, JSON.stringify(updated, null, 2), file.sha, `edit: ${tokenRow.supplierId} ${submissionId}`);

  const prs = await listOpenPullRequestsByPrefix(octokit, org, branch);
  const exact = prs.find((p) => p.head.ref === branch);
  if (exact && exact.labels.some((l) => l.name === 'status:revision')) {
    await removeLabelFromPR(octokit, org, exact.number, 'status:revision');
  }
  return c.redirect(`/submit/${org}/${token}`);
});

export default submit;
