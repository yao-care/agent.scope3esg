import { describe, it, expect } from 'vitest';
import { aggregateKpis } from '../../src/lib/aggregate';

const subs = [
  { supplier_id: 'S1', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 5090 },
  { supplier_id: 'S1', scope3_category: 1, activity_type: 'electricity', calculated_co2e: 1000 },
  { supplier_id: 'S2', scope3_category: 4, activity_type: 'transport', calculated_co2e: 3000 },
];

describe('aggregateKpis', () => {
  it('sums total and counts', () => {
    const k = aggregateKpis(subs);
    expect(k.totalCo2e).toBeCloseTo(9090);
    expect(k.supplierCount).toBe(2);
    expect(k.submissionCount).toBe(3);
  });
  it('groups by category and ranks suppliers', () => {
    const k = aggregateKpis(subs);
    expect(k.byCategory[1]).toBeCloseTo(6090);
    expect(k.topSuppliers[0].supplier_id).toBe('S1');
  });
  it('handles empty', () => {
    const k = aggregateKpis([]);
    expect(k.totalCo2e).toBe(0);
    expect(k.topSuppliers).toEqual([]);
  });
});
