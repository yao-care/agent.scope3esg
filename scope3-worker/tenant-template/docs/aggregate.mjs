// tenant-template/docs/aggregate.mjs
// 純彙整函式：把已核定的 submissions 彙整成儀表板 KPI。
// 同時被瀏覽器（dashboard.js）與 worker 單元測試使用，無外部相依。

export function aggregateKpis(submissions) {
  const subs = Array.isArray(submissions) ? submissions : [];
  let totalCo2e = 0;
  const byCategory = {};
  const byActivity = {};
  const bySupplier = {};

  for (const s of subs) {
    const co2e = Number(s.calculated_co2e) || 0;
    totalCo2e += co2e;
    byCategory[s.scope3_category] = (byCategory[s.scope3_category] || 0) + co2e;
    byActivity[s.activity_type] = (byActivity[s.activity_type] || 0) + co2e;
    bySupplier[s.supplier_id] = (bySupplier[s.supplier_id] || 0) + co2e;
  }

  const topSuppliers = Object.entries(bySupplier)
    .map(([supplier_id, co2e]) => ({ supplier_id, co2e }))
    .sort((a, b) => b.co2e - a.co2e)
    .slice(0, 10);

  return {
    totalCo2e,
    supplierCount: Object.keys(bySupplier).length,
    submissionCount: subs.length,
    byCategory,
    byActivity,
    topSuppliers,
  };
}
