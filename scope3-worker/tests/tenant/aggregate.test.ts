import { describe, it, expect } from 'vitest';
import { aggregateKpis } from '../../tenant-template/docs/aggregate.mjs';

const subs = [
  { supplier_id: 'SUP001', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 5090 },
  { supplier_id: 'SUP001', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 1000 },
  { supplier_id: 'SUP002', scope3_category: 4, activity_type: 'transport', calculated_co2e: 3000 },
];

describe('aggregateKpis', () => {
  it('sums total co2e across all submissions', () => {
    expect(aggregateKpis(subs).totalCo2e).toBeCloseTo(9090);
  });
  it('counts distinct suppliers', () => {
    expect(aggregateKpis(subs).supplierCount).toBe(2);
  });
  it('aggregates co2e by category', () => {
    const byCat = aggregateKpis(subs).byCategory;
    expect(byCat[1]).toBeCloseTo(6090);
    expect(byCat[4]).toBeCloseTo(3000);
  });
  it('ranks top suppliers by co2e descending', () => {
    const top = aggregateKpis(subs).topSuppliers;
    expect(top[0].supplier_id).toBe('SUP001');
    expect(top[0].co2e).toBeCloseTo(6090);
    expect(top[1].supplier_id).toBe('SUP002');
  });
  it('handles empty input', () => {
    const k = aggregateKpis([]);
    expect(k.totalCo2e).toBe(0);
    expect(k.supplierCount).toBe(0);
    expect(k.topSuppliers).toEqual([]);
  });
});
