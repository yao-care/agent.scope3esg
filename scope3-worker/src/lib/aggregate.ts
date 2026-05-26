// src/lib/aggregate.ts
// 伺服器端 KPI 彙整（與 tenant-template/docs/aggregate.mjs 邏輯一致），供 Worker 儀表板用。
export interface Submission {
  supplier_id: string;
  scope3_category: number;
  activity_type: string;
  calculated_co2e: number;
}
export interface Kpis {
  totalCo2e: number;
  supplierCount: number;
  submissionCount: number;
  byCategory: Record<string, number>;
  byActivity: Record<string, number>;
  topSuppliers: Array<{ supplier_id: string; co2e: number }>;
}
export function aggregateKpis(submissions: Submission[]): Kpis {
  const subs = Array.isArray(submissions) ? submissions : [];
  let totalCo2e = 0;
  const byCategory: Record<string, number> = {};
  const byActivity: Record<string, number> = {};
  const bySupplier: Record<string, number> = {};
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
  return { totalCo2e, supplierCount: Object.keys(bySupplier).length, submissionCount: subs.length, byCategory, byActivity, topSuppliers };
}
