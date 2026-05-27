// src/ui/nav.ts
// Manager 工作台共用導覽列（輸出 HTML）。對應 CSS（.nav*）在 src/ui/theme.mjs。
// 與 theme.mjs 分離：theme.mjs 只負責全站 CSS，本檔負責導覽列 HTML 結構。

type NavKey = 'config' | 'review' | 'dashboard' | 'reports';

const NAV_ITEMS: Array<{ key: NavKey; label: string; href: (org: string) => string }> = [
  { key: 'config',    label: '設定',   href: (org) => `/admin/${org}` },
  { key: 'review',    label: '審核',   href: (org) => `/admin/${org}/review` },
  { key: 'dashboard', label: '儀表板', href: (org) => `/dashboard/${org}` },
  { key: 'reports',   label: '報表',   href: (org) => `/admin/${org}/reports` },
];

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderNav(org: string, active: NavKey): string {
  const o = escAttr(org);
  const links = NAV_ITEMS.map((it) => {
    const cls = it.key === active ? 'nav-link active' : 'nav-link';
    const badge = it.key === 'review' ? '<span class="badge nav-pending" id="nav-pending" hidden></span>' : '';
    return `<a class="${cls}" href="${it.href(o)}">${it.label}${badge}</a>`;
  }).join('');
  return `<nav class="nav">
  <span class="nav-brand">Scope3 ▸ ${o}</span>
  <span class="nav-links">${links}</span>
  <button class="btn btn-secondary nav-logout" id="nav-logout" type="button">登出</button>
</nav>
<script>
(function(){
  var org=${JSON.stringify(org)};
  fetch('/api/v1/admin/'+org+'/review/count').then(function(r){return r.json();}).then(function(d){
    var b=document.getElementById('nav-pending');
    if(b && d && d.pending>0){ b.textContent=d.pending; b.hidden=false; }
  }).catch(function(){});
  var lo=document.getElementById('nav-logout');
  if(lo) lo.addEventListener('click', function(){
    fetch('/admin/'+org+'/logout',{method:'POST'}).then(function(){ location.href='/admin/'+org+'/login'; });
  });
})();
</script>`;
}
