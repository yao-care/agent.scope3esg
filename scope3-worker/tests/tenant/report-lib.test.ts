import { describe, it, expect } from 'vitest';
import { toCsv, toGhgMarkdown } from '../../tenant-template/scripts/report-lib.mjs';

const subs = [
  { submission_id: 'a1', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 10000, unit: 'kWh', emission_factor_id: 'TW_ELEC_2025', calculated_co2e: 5090, source_file: 'submissions/SUP001/a1.json' },
  { submission_id: 'b2', supplier_id: 'SUP002', scope3_category: 4, period: '2025-Q1', activity_type: 'transport', amount: 500, unit: 'km', emission_factor_id: 'GLOBAL_TRANSPORT_2025', calculated_co2e: 60, source_file: 'submissions/SUP002/b2.json' },
];

describe('toCsv', () => {
  it('produces a header row plus one row per submission', () => {
    const lines = toCsv(subs).trim().split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('supplier_id');
    expect(lines[0]).toContain('calculated_co2e');
    expect(lines[0]).toContain('source_file');
    expect(lines[0]).not.toContain('issue_number');
  });
  it('escapes fields containing commas', () => {
    const csv = toCsv([{ ...subs[0], supplier_id: 'A,B' }]);
    expect(csv).toContain('"A,B"');
  });
  it('handles empty input with header only', () => {
    expect(toCsv([]).trim().split('\n').length).toBe(1);
  });
});

describe('toGhgMarkdown', () => {
  it('includes total tCO2e and per-category breakdown', () => {
    const md = toGhgMarkdown(subs, 2025);
    expect(md).toContain('2025');
    expect(md).toMatch(/5\.15|5\.150|5150/);
    expect(md).toContain('Category 1');
    expect(md).toContain('Category 4');
  });
});
