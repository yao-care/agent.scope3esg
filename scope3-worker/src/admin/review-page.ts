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
var ACTIVITY_ZH = {electricity:'電力',natural_gas:'天然氣',diesel:'柴油',water:'用水',waste:'廢棄物',product:'產品',transport:'運輸'};
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function light(v){ var m={success:['✅','已驗證'],failure:['❌','驗證未過'],pending:['⏳','驗證中']}; var x=m[v]||m.pending; return '<span class="badge">'+x[0]+' '+x[1]+'</span>'; }
function postAction(pr, path, body, failMsg){
  var opt = { method:'POST', credentials:'same-origin' };
  if(body){ opt.headers={'Content-Type':'application/json'}; opt.body=JSON.stringify(body); }
  return fetch('/api/v1/admin/'+ORG+'/review/'+pr+path, opt)
    .then(function(r){ return r.json().catch(function(){return {};}).then(function(d){ return {s:r.status, d:d}; }); })
    .then(function(x){
      if(x.d && x.d.ok){ load(); return; }
      if(x.s===401){ alert('您的登入已逾時，請重新登入後再操作。'); location.href='/admin/'+ORG+'/login'; return; }
      if(x.d && x.d.detail){ try{ console.log('detail:', x.d.detail); }catch(e){} }
      alert(failMsg+'，請重新整理頁面後再試；若持續發生請聯繫系統管理員。');
    })
    .catch(function(){ alert(failMsg+'，請檢查網路後再試。'); });
}
function approve(pr){ if(!confirm('確定要核定這筆提交嗎？核定後將併入正式盤查資料。')) return; postAction(pr, '/approve', null, '核定失敗'); }
function reject(pr){ var reason=prompt('退件原因（會顯示給供應商）：'); if(reason===null) return; postAction(pr, '/reject', {reason:reason}, '退件失敗'); }
function rowHtml(r){
  var head, body='';
  if(r.type==='withdrawal'){
    head='<strong>撤回</strong> ｜ '+esc(r.supplier_id)+' ｜ '+esc(r.title);
  } else {
    var d=r.data||{};
    head='<strong>提交</strong> ｜ '+esc(r.supplier_id)+' ｜ 第'+esc(d.scope3_category)+'類 '+esc(CAT_NAMES[(d.scope3_category||1)-1]||'')+' ｜ '+esc(d.period)+' ｜ '+light(r.validate)+(r.needsRevision?' <span class="badge">需修改</span>':'');
    body='<div class="muted">活動：'+(ACTIVITY_ZH[d.activity_type]||esc(d.activity_type))+' ｜ 數量：'+esc(d.amount)+' '+esc(d.unit)+'</div>';
    var ev=(d.evidence_urls||[]);
    body+='<details><summary class="muted" style="cursor:pointer">完整詳情</summary>'+
      '<div class="muted">提交時間：'+esc(d.submitted_at)+' ｜ 管道：'+esc(d.channel)+' ｜ 提交 ID：'+esc(d.submission_id)+'</div>'+
      '<div>佐證：'+(ev.length ? ev.map(function(u,i){return '<a class="btn btn-secondary" href="'+esc(u)+'" target="_blank">下載檔'+(i+1)+'</a>';}).join(' ') : '<span class="muted">無佐證檔</span>')+'</div>'+
      '</details>';
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
