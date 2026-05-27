// src/admin/review-page.ts
import { renderNav } from '../ui/nav';

export function reviewPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 審核中心 — ${org}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
${renderNav(org, 'review')}
<div class="container">
<h1>審核中心 — ${org}</h1>
<p class="muted" id="subtitle">載入中…</p>
<div id="list"></div>
</div>
<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function light(v){ var m={success:['✅','已驗證'],failure:['❌','驗證未過'],pending:['⏳','驗證中']}; var x=m[v]||m.pending; return '<span class="badge">'+x[0]+' '+x[1]+'</span>'; }
function approve(pr){ if(!confirm('確定核定並 merge 此 PR？')) return;
  fetch('/api/v1/admin/'+ORG+'/review/'+pr+'/approve',{method:'POST'}).then(function(r){return r.json();}).then(function(d){
    if(d.ok){ load(); } else { alert('核定失敗：'+(d.detail||d.error||'')); }
  }); }
function reject(pr){ var reason=prompt('退件理由（會顯示給供應商）：'); if(reason===null) return;
  fetch('/api/v1/admin/'+ORG+'/review/'+pr+'/reject',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason})})
    .then(function(r){return r.json();}).then(function(){ load(); }); }
function rowHtml(r){
  var head, body='';
  if(r.type==='withdrawal'){
    head='<strong>撤回</strong> ｜ '+esc(r.supplier_id)+' ｜ '+esc(r.title);
  } else {
    var d=r.data||{};
    head='<strong>提交</strong> ｜ '+esc(r.supplier_id)+' ｜ Cat.'+esc(d.scope3_category)+' '+esc(CAT_NAMES[(d.scope3_category||1)-1]||'')+' ｜ '+esc(d.period)+' ｜ '+light(r.validate)+(r.needsRevision?' <span class="badge">需修改</span>':'');
    body='<div class="muted">活動：'+esc(d.activity_type)+' ｜ 數量：'+esc(d.amount)+' '+esc(d.unit)+'</div>';
    var ev=(d.evidence_urls||[]); if(ev.length){ body+='<div class="muted">佐證：'+ev.map(function(u,i){return '<a href="'+esc(u)+'" target="_blank">檔'+(i+1)+'</a>';}).join(' ')+'</div>'; }
  }
  var actions = r.type==='withdrawal'
    ? '<button class="btn btn-primary" onclick="approve('+r.number+')">確認撤回</button> <button class="btn btn-secondary" onclick="reject('+r.number+')">駁回</button>'
    : '<button class="btn btn-primary" onclick="approve('+r.number+')">核定</button> <button class="btn btn-danger" onclick="reject('+r.number+')">退件</button>';
  return '<section class="card"><div>'+head+'</div>'+body+'<p>'+actions+'</p></section>';
}
function load(){
  fetch('/api/v1/admin/'+ORG+'/review/list').then(function(r){return r.json();}).then(function(d){
    var rv=d.reviews||[];
    document.getElementById('subtitle').textContent='待審 '+rv.length+' 筆';
    document.getElementById('list').innerHTML = rv.length ? rv.map(rowHtml).join('') : '<div class="card muted">目前沒有待審項目</div>';
  }).catch(function(){ document.getElementById('subtitle').textContent='無法載入'; });
}
load();
</script>
</body>
</html>`;
}
