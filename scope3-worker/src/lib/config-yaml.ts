// src/lib/config-yaml.ts
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';
import type { TenantConfig, SupplierConfig } from '../types';

export function configToYaml(config: TenantConfig): string {
  const normalized: TenantConfig = {
    inventory_year: config.inventory_year,
    enabled_categories: config.enabled_categories ?? [],
    suppliers: (config.suppliers ?? []).map(normalizeSupplier),
  };
  return yamlDump(normalized, { lineWidth: 120, noRefs: true });
}

export function yamlToConfig(yaml: string): TenantConfig {
  const raw = (yamlLoad(yaml) ?? {}) as Partial<TenantConfig>;
  return {
    inventory_year: Number(raw.inventory_year) || new Date().getFullYear(),
    enabled_categories: Array.isArray(raw.enabled_categories) ? raw.enabled_categories.map(Number) : [],
    suppliers: Array.isArray(raw.suppliers) ? raw.suppliers.map(normalizeSupplier) : [],
  };
}

function normalizeSupplier(s: Partial<SupplierConfig>): SupplierConfig {
  return {
    id: String(s.id ?? ''),
    name: String(s.name ?? ''),
    contact: String(s.contact ?? ''),
    pull_api: s.pull_api ?? null,
    pull_schedule: s.pull_schedule ?? null,
  };
}
