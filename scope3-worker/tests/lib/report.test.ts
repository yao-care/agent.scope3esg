import { describe, it, expect } from 'vitest';
import { toCsv, toGhgMarkdown } from '../../src/lib/report';
import { toCsv as mjsToCsv, toGhgMarkdown as mjsToGhg } from '../../tenant-template/scripts/report-lib.mjs';

const FIX = [
  { submission_id: 'a', supplier_id: 'SUP001', scope3_category: 1, period: '2025-Q1', activity_type: 'electricity', amount: 100, unit: 'kWh', emission_factor_id: 'TW_ELEC_2025', calculated_co2e: 50, source_file: 'submissions/SUP001/a.json' },
  { submission_id: 'b', supplier_id: 'SUP002', scope3_category: 4, period: '2025-Q2', activity_type: 'transport', amount: 1200, unit: 'km', emission_factor_id: 'GLOBAL_TRANSPORT_2025', calculated_co2e: 144, source_file: 'submissions/SUP002/b.json' },
];

describe('report.ts', () => {
  it('toCsv emits header with source_file column and one row per submission', () => {
    const csv = toCsv(FIX);
    expect(csv.split('\n')[0]).toBe('submission_id,supplier_id,scope3_category,period,activity_type,amount,unit,emission_factor_id,calculated_co2e,source_file');
    expect(csv).toContain('a,SUP001,1,2025-Q1,electricity,100,kWh,TW_ELEC_2025,50,submissions/SUP001/a.json');
  });
  it('toCsv handles empty input (header only)', () => {
    expect(toCsv([])).toBe('submission_id,supplier_id,scope3_category,period,activity_type,amount,unit,emission_factor_id,calculated_co2e,source_file\n');
  });
  it('toGhgMarkdown shows total and per-category in tCO2e', () => {
    const md = toGhgMarkdown(FIX, '2025');
    expect(md).toContain('盤點年度：2025');
    expect(md).toContain('已核定筆數：2');
    expect(md).toContain('0.194');
    expect(md).toContain('| Category 1 | 0.050 |');
    expect(md).toContain('| Category 4 | 0.144 |');
  });
  it('matches the tenant-template .mjs output (cross-source consistency)', () => {
    expect(toCsv(FIX)).toBe(mjsToCsv(FIX));
    const norm = (s: string) => s.replace(/自動產生於 .*$/m, '自動產生於 X');
    expect(norm(toGhgMarkdown(FIX, '2025'))).toBe(norm(mjsToGhg(FIX, '2025')));
  });
});
