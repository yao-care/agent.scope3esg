// src/admin/reports-page.ts
import { renderNav } from '../ui/nav';

export function reportsPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 報表 — ${org}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body>
${renderNav(org, 'reports')}
<div class="container">
<h1>報表 — ${org}</h1>
<section class="card">
  <label class="label">盤點年度</label>
  <select class="select" id="year" style="max-width:200px"></select>
  <p><a class="btn btn-primary" id="dl-csv" href="#">下載 CSV</a></p>
</section>
<section class="card"><h2>GHG 總覽</h2><div class="kpis" id="kpis"></div><div id="by-category"></div></section>
</div>
<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];
function fmt(n){ return Number(n).toLocaleString('en-US',{maximumFractionDigits:3}); }
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function bars(id, rows){ var el=document.getElementById(id); if(!rows.length){ el.innerHTML='<div class="muted">尚無資料</div>'; return; }
  var max=Math.max.apply(null, rows.map(function(r){return r.value;}).concat([1]));
  el.innerHTML=rows.map(function(r){ var pct=(r.value/max)*100; return '<div class="bar-row"><span class="name">'+esc(r.name)+'</span><span class="bar-track"><span class="bar-fill" style="width:'+pct+'%"></span></span><span class="num">'+fmt(r.value/1000)+'</span></div>'; }).join(''); }
function setDl(){ var y=document.getElementById('year').value; document.getElementById('dl-csv').href='/api/v1/admin/'+ORG+'/reports?format=csv'+(y?'&year='+encodeURIComponent(y):''); }
function loadData(){
  var y=document.getElementById('year').value;
  fetch('/api/v1/admin/'+ORG+'/dashboard-data'+(y?'?year='+encodeURIComponent(y):'')).then(function(r){return r.json();}).then(function(k){
    document.getElementById('kpis').innerHTML='<div class="card"><div class="muted">Total Scope 3</div><div class="kpi-value">'+fmt(k.totalCo2e/1000)+' <span class="kpi-unit">tCO₂e</span></div></div>'+
      '<div class="card"><div class="muted">已核定筆數</div><div class="kpi-value">'+k.submissionCount+' <span class="kpi-unit">筆</span></div></div>';
    bars('by-category', Object.keys(k.byCategory).map(function(cat){return {name:'Cat.'+cat+' '+(CAT_NAMES[cat-1]||''), value:k.byCategory[cat]};}).sort(function(a,b){return b.value-a.value;}));
    setDl();
  });
}
fetch('/api/v1/admin/'+ORG+'/dashboard-data').then(function(r){return r.json();}).then(function(k){
  var ys=(k.availableYears||[]); var sel=document.getElementById('year');
  sel.innerHTML='<option value="">全部年度</option>'+ys.map(function(y){return '<option value="'+esc(y)+'">'+esc(y)+'</option>';}).join('');
  sel.addEventListener('change', loadData);
  loadData();
});
</script>
</body></html>`;
}
