import { describe, it, expect } from 'vitest';
import { configToYaml, yamlToConfig } from '../../src/lib/config-yaml';

const config = {
  inventory_year: 2026,
  enabled_categories: [1, 4, 6],
  suppliers: [
    { id: 'SUP001', name: '台鋼', contact: 'esg@twsteel.com', pull_api: null, pull_schedule: null },
  ],
};

describe('config-yaml', () => {
  it('round-trips config through YAML', () => {
    const yaml = configToYaml(config);
    const parsed = yamlToConfig(yaml);
    expect(parsed.inventory_year).toBe(2026);
    expect(parsed.enabled_categories).toEqual([1, 4, 6]);
    expect(parsed.suppliers[0].id).toBe('SUP001');
    expect(parsed.suppliers[0].contact).toBe('esg@twsteel.com');
  });
  it('produces valid YAML string', () => {
    const yaml = configToYaml(config);
    expect(yaml).toContain('inventory_year: 2026');
    expect(yaml).toContain('SUP001');
  });
  it('yamlToConfig fills defaults for empty config', () => {
    const parsed = yamlToConfig('inventory_year: 2025\nenabled_categories: []\nsuppliers: []\n');
    expect(parsed.suppliers).toEqual([]);
    expect(parsed.enabled_categories).toEqual([]);
  });
  it('yamlToConfig normalizes missing supplier fields', () => {
    const parsed = yamlToConfig('inventory_year: 2025\nenabled_categories: [1]\nsuppliers:\n  - id: S1\n    name: X\n    contact: x@y.com\n');
    expect(parsed.suppliers[0].pull_api).toBeNull();
    expect(parsed.suppliers[0].pull_schedule).toBeNull();
  });
});
