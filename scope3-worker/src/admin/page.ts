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
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; background: #f7f8fa; color: #1a1a1a; }
  h1 { font-size: 1.4rem; } h2 { font-size: 1.05rem; margin-top: 0; }
  section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  label { font-size: .85rem; color: #555; }
  input, select { padding: 6px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid #eee; }
  td input { width: 100%; }
  button { padding: 8px 16px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: .9rem; }
  button.secondary { background: #eee; color: #333; }
  button.danger { background: #d93f0b; }
  .cats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; font-size: .85rem; }
  .row-actions { white-space: nowrap; }
  .toast { position: fixed; top: 16px; right: 16px; background: #0e8a16; color: #fff; padding: 12px 20px; border-radius: 4px; display: none; }
  code { background: #f0f0f0; padding: 2px 4px; border-radius: 3px; font-size: .8rem; word-break: break-all; }
  .muted { color: #888; }
</style>
</head>
<body>
<h1>Scope 3 盤點管理 — ${org}</h1>

<section>
  <h2>① 盤點設定</h2>
  <label>盤點年度 <input id="year" type="number" style="width:100px"></label>
  <p style="margin:12px 0 4px">盤查類別（Scope 3 Category）</p>
  <div class="cats" id="cats"></div>
</section>

<section>
  <h2>② 供應商清單</h2>
  <table><thead><tr><th>ID</th><th>名稱</th><th>聯絡 Email</th><th>Pull API</th><th>排程</th><th></th></tr></thead>
  <tbody id="suppliers"></tbody></table>
  <p><button class="secondary" id="addRow">+ 新增供應商</button></p>
</section>

<p><button id="save">💾 儲存設定</button> <span id="saveStatus" class="muted"></span></p>

<section>
  <h2>③ 供應商連結一覽</h2>
  <table><thead><tr><th>供應商</th><th>填表連結</th><th></th></tr></thead><tbody id="links"></tbody></table>
</section>

<section>
  <h2>④ 提交狀態</h2>
  <table><thead><tr><th>#</th><th>標題</th><th>狀態</th></tr></thead><tbody id="subs"></tbody></table>
</section>

<div class="toast" id="toast"></div>

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
  return '<tr>'+
    '<td><input class="s-id" value="'+esc(s.id)+'"></td>'+
    '<td><input class="s-name" value="'+esc(s.name)+'"></td>'+
    '<td><input class="s-contact" value="'+esc(s.contact)+'"></td>'+
    '<td><input class="s-api" value="'+esc(s.pull_api)+'"></td>'+
    '<td><input class="s-sched" value="'+esc(s.pull_schedule)+'"></td>'+
    '<td class="row-actions"><button class="danger del-row" type="button">刪</button></td></tr>';
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
      pull_schedule:tr.querySelector('.s-sched').value.trim()||null
    });
  }
  return { inventory_year:Number(document.getElementById('year').value)||new Date().getFullYear(), enabled_categories:enabled, suppliers:suppliers };
}

function load(){
  fetch('/api/v1/admin/'+ORG+'/config').then(function(r){return r.json();}).then(function(cfg){
    document.getElementById('year').value=cfg.inventory_year;
    renderCats(cfg.enabled_categories||[]);
    var sup=cfg.suppliers||[];
    var html=''; for(var i=0;i<sup.length;i++) html+=supplierRowHtml(sup[i]);
    document.getElementById('suppliers').innerHTML=html||supplierRowHtml({});
    loadLinks(); loadSubs();
  });
}

function loadLinks(){
  fetch('/api/v1/admin/'+ORG+'/links').then(function(r){return r.json();}).then(function(d){
    var links=d.links||[]; var html='';
    for(var i=0;i<links.length;i++){
      html+='<tr><td>'+esc(links[i].supplierId)+'</td><td><code>'+esc(links[i].url)+'</code></td>'+
            '<td><button class="secondary copy-link" type="button" data-url="'+esc(links[i].url)+'">複製</button></td></tr>';
    }
    document.getElementById('links').innerHTML=html||'<tr><td colspan="3" class="muted">尚無連結</td></tr>';
  });
}

function loadSubs(){
  fetch('/api/v1/admin/'+ORG+'/submissions').then(function(r){return r.json();}).then(function(d){
    var subs=d.submissions||[]; var html='';
    for(var i=0;i<subs.length;i++) html+='<tr><td>'+esc(subs[i].number)+'</td><td>'+esc(subs[i].title)+'</td><td>'+esc(subs[i].status)+'</td></tr>';
    document.getElementById('subs').innerHTML=html||'<tr><td colspan="3" class="muted">尚無提交</td></tr>';
  }).catch(function(){ document.getElementById('subs').innerHTML='<tr><td colspan="3" class="muted">無法載入</td></tr>'; });
}

function save(){
  document.getElementById('saveStatus').textContent='儲存中…';
  fetch('/api/v1/admin/'+ORG+'/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(collectConfig())})
    .then(function(res){
      if(res.ok){ toast('已儲存，連結已更新'); document.getElementById('saveStatus').textContent='✅ 已儲存'; loadLinks(); }
      else { toast('儲存失敗'); document.getElementById('saveStatus').textContent='❌ 失敗'; }
    });
}

// 事件委派
document.getElementById('addRow').addEventListener('click', addRow);
document.getElementById('save').addEventListener('click', save);
document.getElementById('suppliers').addEventListener('click', function(e){
  if(e.target && e.target.classList.contains('del-row')){ var tr=e.target.closest('tr'); if(tr) tr.remove(); }
});
document.getElementById('links').addEventListener('click', function(e){
  if(e.target && e.target.classList.contains('copy-link')){
    navigator.clipboard.writeText(e.target.getAttribute('data-url')); toast('已複製');
  }
});

load();
</script>
</body>
</html>`;
}
