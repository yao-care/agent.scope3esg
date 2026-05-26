// src/routes/dashboard.ts
import { Hono } from 'hono';
import type { Bindings, Variables } from '../types';
import { verifySession } from '../lib/session';

const dashboard = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

dashboard.get('/:org', async (c) => {
  const { org } = c.req.param();
  const cookie = readCookie(c.req.header('Cookie') ?? '', 'scope3_session');
  const session = cookie ? await verifySession(cookie, c.env.SESSION_SECRET) : null;
  if (!session || session.org !== org) {
    return c.redirect(`/admin/${org}/login`);
  }
  return c.html(dashboardHtml(org));
});

function dashboardHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 儀表板 — ${org}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="container">
<h1>Scope 3 碳排儀表板 — ${org}</h1>
<p class="muted" id="subtitle">載入中…</p>
<div class="kpis" id="kpis"></div>
<section class="card"><h2>各類別排放量（kgCO₂e）</h2><div id="by-category"></div></section>
<section class="card"><h2>排放前 10 供應商（kgCO₂e）</h2><div id="top-suppliers"></div></section>
<section class="card"><h2>各活動類型排放量（kgCO₂e）</h2><div id="by-activity"></div></section>
</div>
<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];
function fmt(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:1}); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function bars(id, rows){
  var el=document.getElementById(id);
  if(!rows.length){ el.innerHTML='<div class="muted">尚無資料</div>'; return; }
  var max=Math.max.apply(null, rows.map(function(r){return r.value;}).concat([1]));
  el.innerHTML=rows.map(function(r){
    var pct=(r.value/max)*100;
    return '<div class="bar-row"><span class="name">'+esc(r.name)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span><span class="num">'+fmt(r.value)+'</span></div>';
  }).join('');
}
fetch('/api/v1/admin/'+ORG+'/dashboard-data').then(function(r){return r.json();}).then(function(k){
  document.getElementById('subtitle').textContent='共 '+k.submissionCount+' 筆已核定資料 ｜ 更新於 '+new Date().toLocaleString('zh-TW');
  var cards=[
    {label:'Total Scope 3', value:fmt(k.totalCo2e/1000), unit:'tCO₂e'},
    {label:'供應商數', value:k.supplierCount, unit:'家'},
    {label:'已核定筆數', value:k.submissionCount, unit:'筆'},
    {label:'涵蓋類別數', value:Object.keys(k.byCategory).length, unit:'類'}
  ];
  document.getElementById('kpis').innerHTML=cards.map(function(c){
    return '<div class="card"><div class="muted">'+c.label+'</div><div class="kpi-value">'+c.value+' <span class="kpi-unit">'+c.unit+'</span></div></div>';
  }).join('');
  bars('by-category', Object.keys(k.byCategory).map(function(cat){return {name:'Cat.'+cat+' '+(CAT_NAMES[cat-1]||''), value:k.byCategory[cat]};}).sort(function(a,b){return b.value-a.value;}));
  bars('top-suppliers', k.topSuppliers.map(function(s){return {name:s.supplier_id, value:s.co2e};}));
  bars('by-activity', Object.keys(k.byActivity).map(function(a){return {name:a, value:k.byActivity[a]};}).sort(function(a,b){return b.value-a.value;}));
}).catch(function(){ document.getElementById('subtitle').textContent='無法載入資料'; });
</script>
</body>
</html>`;
}

export default dashboard;
