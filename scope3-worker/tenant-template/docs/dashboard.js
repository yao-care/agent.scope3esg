// tenant-template/docs/dashboard.js
import { aggregateKpis } from './aggregate.mjs';

const ACTIVITY_ZH = {electricity:'電力',natural_gas:'天然氣',diesel:'柴油',water:'用水',waste:'廢棄物',product:'產品',transport:'運輸'};

const CATEGORY_NAMES = {
  1: '採購商品與服務', 2: '資本財', 3: '燃料與能源', 4: '上游運輸配送',
  5: '營運廢棄物', 6: '商務旅行', 7: '員工通勤', 8: '上游租賃資產',
  9: '下游運輸配送', 10: '售出產品加工', 11: '售出產品使用', 12: '售出產品報廢',
  13: '下游租賃資產', 14: '加盟', 15: '投資',
};

function fmt(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function renderBars(containerId, rows) {
  const el = document.getElementById(containerId);
  if (!rows.length) { el.innerHTML = '<div class="empty">尚無資料</div>'; return; }
  const max = Math.max(...rows.map((r) => r.value), 1);
  el.innerHTML = rows
    .map((r) => {
      const pct = (r.value / max) * 100;
      return `<div class="bar-row">
        <span class="name">${r.name}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        <span class="num">${fmt(r.value)}</span>
      </div>`;
    })
    .join('');
}

function renderKpis(k) {
  const cards = [
    { label: 'Scope 3 總排放', value: fmt(k.totalCo2e / 1000), unit: 'tCO₂e' },
    { label: '供應商數', value: k.supplierCount, unit: '家' },
    { label: '已核定筆數', value: k.submissionCount, unit: '筆' },
    { label: '涵蓋類別數', value: Object.keys(k.byCategory).length, unit: '類' },
  ];
  document.getElementById('kpis').innerHTML = cards
    .map((c) => `<div class="card"><div class="muted">${c.label}</div><div class="kpi-value">${c.value} <span class="kpi-unit">${c.unit}</span></div></div>`)
    .join('');
}

async function main() {
  let subs = [];
  try {
    const res = await fetch('./data/submissions.json', { cache: 'no-store' });
    if (res.ok) subs = await res.json();
  } catch {
    // 無資料檔，視為空
  }
  if (!Array.isArray(subs)) subs = [];

  const k = aggregateKpis(subs);
  document.getElementById('subtitle').textContent = `共 ${k.submissionCount} 筆已核定資料 ｜ 更新於 ${new Date().toLocaleString('zh-TW')}`;
  renderKpis(k);

  renderBars(
    'by-category',
    Object.entries(k.byCategory)
      .map(([cat, value]) => ({ name: `第${cat}類 ${CATEGORY_NAMES[cat] || ''}`, value }))
      .sort((a, b) => b.value - a.value),
  );
  renderBars(
    'top-suppliers',
    k.topSuppliers.map((s) => ({ name: s.supplier_id, value: s.co2e })),
  );
  renderBars(
    'by-activity',
    Object.entries(k.byActivity)
      .map(([name, value]) => ({ name: (ACTIVITY_ZH[name] || name), value }))
      .sort((a, b) => b.value - a.value),
  );
}

main();
