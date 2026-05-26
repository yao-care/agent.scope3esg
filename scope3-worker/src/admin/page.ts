// src/admin/page.ts
// ESG Manager 管理介面單頁。所有 ${...} 都是「伺服器端」插值（僅注入 org）；
// 前端 JS 一律用字串拼接、事件委派，避免與外層 template literal 的 ${} 衝突，也避免 inline onclick 引號 escape。
export function adminPageHtml(org: string): string {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Scope 3 管理 — ${org}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="container">
<h1>Scope 3 盤點管理 — ${org}</h1>

<section class="card">
  <h2>① 盤點設定</h2>
  <label class="label">盤點年度 <input class="input" id="year" type="number" style="width:100px"></label>
  <p style="margin:12px 0 4px">盤查類別（Scope 3 Category）</p>
  <div class="cats" id="cats"></div>
</section>

<section class="card">
  <h2>② 供應商</h2>
  <table class="table"><thead><tr><th>ID</th><th>名稱</th><th>聯絡 Email</th><th>Pull API</th><th>排程</th><th>Pull 金鑰</th><th>填表連結</th><th>已提交</th><th></th></tr></thead>
  <tbody id="suppliers"></tbody></table>
  <p><button class="btn btn-secondary" id="addRow">+ 新增供應商</button></p>
  <p><button class="btn btn-primary" id="save">💾 儲存設定</button> <span id="saveStatus" class="muted"></span></p>
</section>

<div class="toast" id="toast"></div>
</div>

<script>
var ORG = ${JSON.stringify(org)};
var CAT_NAMES = ['採購商品與服務','資本財','燃料與能源','上游運輸配送','營運廢棄物','商務旅行','員工通勤','上游租賃資產','下游運輸配送','售出產品加工','售出產品使用','售出產品報廢','下游租賃資產','加盟','投資'];

function esc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toast(msg){ var t=document.getElementById('toast'); t.textContent=msg; t.style.display='block'; setTimeout(function(){ t.style.display='none'; },2500); }

function renderCats(enabled){
  var html='';
  for(var i=0;i<CAT_NAMES.length;i++){
    var c=i+1; var ck=enabled.indexOf(c)>=0?'checked':'';
    html+='<label><input type="checkbox" class="cat" value="'+c+'" '+ck+'> '+c+'. '+esc(CAT_NAMES[i])+'</label>';
  }
  document.getElementById('cats').innerHTML=html;
}

function supplierRowHtml(s){
  s=s||{};
  var linkCell = s.formUrl
    ? '<code>'+esc(s.formUrl)+'</code> <button class="btn btn-secondary copy-link" type="button" data-url="'+esc(s.formUrl)+'">複製</button>'
    : '<span class="muted">存檔後產生</span>';
  var count = (s.submissionCount != null) ? s.submissionCount : 0;
  return '<tr>'+
    '<td><input class="input s-id" value="'+esc(s.id)+'"></td>'+
    '<td><input class="input s-name" value="'+esc(s.name)+'"></td>'+
    '<td><input class="input s-contact" value="'+esc(s.contact)+'"></td>'+
    '<td><input class="input s-api" value="'+esc(s.pull_api)+'"></td>'+
    '<td><input class="input s-sched" value="'+esc(s.pull_schedule)+'"></td>'+
    '<td><input class="input s-apitoken" value="'+esc(s.pull_api_token)+'"></td>'+
    '<td>'+linkCell+'</td>'+
    '<td>'+esc(count)+'</td>'+
    '<td class="row-actions"><button class="btn btn-danger del-row" type="button">刪</button></td></tr>';
}

function addRow(){ document.getElementById('suppliers').insertAdjacentHTML('beforeend', supplierRowHtml({})); }

function collectConfig(){
  var cats=document.querySelectorAll('.cat:checked');
  var enabled=[]; for(var i=0;i<cats.length;i++) enabled.push(Number(cats[i].value));
  var rows=document.querySelectorAll('#suppliers tr');
  var suppliers=[];
  for(var j=0;j<rows.length;j++){
    var tr=rows[j];
    var id=tr.querySelector('.s-id').value.trim();
    if(!id) continue;
    suppliers.push({
      id:id,
      name:tr.querySelector('.s-name').value.trim(),
      contact:tr.querySelector('.s-contact').value.trim(),
      pull_api:tr.querySelector('.s-api').value.trim()||null,
      pull_schedule:tr.querySelector('.s-sched').value.trim()||null,
      pull_api_token:tr.querySelector('.s-apitoken').value.trim()||null
    });
  }
  return { inventory_year:Number(document.getElementById('year').value)||new Date().getFullYear(), enabled_categories:enabled, suppliers:suppliers };
}

function load(){
  fetch('/api/v1/admin/'+ORG+'/overview').then(function(r){return r.json();}).then(function(data){
    document.getElementById('year').value=data.inventory_year;
    renderCats(data.enabled_categories||[]);
    var sup=data.suppliers||[];
    var html=''; for(var i=0;i<sup.length;i++) html+=supplierRowHtml(sup[i]);
    document.getElementById('suppliers').innerHTML=html||supplierRowHtml({});
  });
}

function save(){
  document.getElementById('saveStatus').textContent='儲存中…';
  fetch('/api/v1/admin/'+ORG+'/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(collectConfig())})
    .then(function(res){
      if(res.ok){ toast('已儲存，連結已更新'); document.getElementById('saveStatus').textContent='✅ 已儲存'; load(); }
      else { toast('儲存失敗'); document.getElementById('saveStatus').textContent='❌ 失敗'; }
    });
}

// 事件委派
document.getElementById('addRow').addEventListener('click', addRow);
document.getElementById('save').addEventListener('click', save);
document.getElementById('suppliers').addEventListener('click', function(e){
  if(e.target && e.target.classList.contains('del-row')){ var tr=e.target.closest('tr'); if(tr) tr.remove(); }
  if(e.target && e.target.classList.contains('copy-link')){
    navigator.clipboard.writeText(e.target.getAttribute('data-url')); toast('已複製');
  }
});

load();
</script>
</body>
</html>`;
}
