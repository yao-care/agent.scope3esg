import { describe, it, expect } from 'vitest';
import { validateUnit, convertUnit, matchFactor, calculateCo2e, detectOutlier } from '../../tenant-template/scripts/lib.mjs';

const factors = [
  { factor_id: 'TW_ELEC_2025', year: 2025, activity_type: 'electricity', value: 0.509, unit: 'kgCO2e/kWh', region: 'TW' },
  { factor_id: 'TW_ELEC_2024', year: 2024, activity_type: 'electricity', value: 0.495, unit: 'kgCO2e/kWh', region: 'TW' },
  { factor_id: 'TW_WASTE_2025', year: 2025, activity_type: 'waste', value: 0.021, unit: 'kgCO2e/kg', region: 'TW' },
];

describe('validateUnit', () => {
  it('accepts a legal unit', () => {
    expect(validateUnit('electricity', 'kWh').ok).toBe(true);
  });
  it('rejects an illegal unit', () => {
    const r = validateUnit('natural_gas', 'kg');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/kg/);
  });
  it('rejects an unknown activity type', () => {
    expect(validateUnit('unicorn', 'kWh').ok).toBe(false);
  });
});

describe('convertUnit', () => {
  it('returns same amount for identical units', () => {
    expect(convertUnit(5, 'kg', 'kg')).toBe(5);
  });
  it('converts ton to kg', () => {
    expect(convertUnit(2, 'ton', 'kg')).toBe(2000);
  });
  it('returns null for incompatible units', () => {
    expect(convertUnit(1, 'kWh', 'kg')).toBeNull();
  });
});

describe('matchFactor', () => {
  it('returns exact region+year match', () => {
    expect(matchFactor(factors, 'electricity', 'TW', 2025)?.factor_id).toBe('TW_ELEC_2025');
  });
  it('falls back to latest same-region when year missing', () => {
    expect(matchFactor(factors, 'electricity', 'TW', 2023)?.factor_id).toBe('TW_ELEC_2025');
  });
  it('returns null when activity type not found', () => {
    expect(matchFactor(factors, 'transport', 'TW', 2025)).toBeNull();
  });
});

describe('calculateCo2e', () => {
  it('multiplies amount by factor value for matching denominator unit', () => {
    const f = factors[0];
    expect(calculateCo2e(10000, 'kWh', f)).toBeCloseTo(5090);
  });
  it('converts ton to kg before multiplying', () => {
    const f = factors[2];
    expect(calculateCo2e(2, 'ton', f)).toBeCloseTo(42);
  });
  it('returns null when units cannot convert', () => {
    const f = factors[0];
    expect(calculateCo2e(5, 'kg', f)).toBeNull();
  });
  it('computes water in ton directly (denominator matches)', () => {
    const water = { factor_id: 'TW_WATER_2025', year: 2025, activity_type: 'water', value: 0.194, unit: 'kgCO2e/ton', region: 'TW' };
    expect(calculateCo2e(100, 'ton', water)).toBeCloseTo(19.4);
  });
});

describe('validateUnit (water uses ton only)', () => {
  it('accepts water in ton', () => {
    expect(validateUnit('water', 'ton').ok).toBe(true);
  });
  it('rejects water in m3 (not supported, would fail to convert)', () => {
    expect(validateUnit('water', 'm3').ok).toBe(false);
  });
});

describe('detectOutlier', () => {
  it('flags values over 10x historical average', () => {
    expect(detectOutlier(20000, [1000, 1500, 2000]).outlier).toBe(true);
  });
  it('does not flag normal values', () => {
    expect(detectOutlier(1800, [1000, 1500, 2000]).outlier).toBe(false);
  });
  it('does not flag when no history', () => {
    expect(detectOutlier(99999, []).outlier).toBe(false);
  });
});
