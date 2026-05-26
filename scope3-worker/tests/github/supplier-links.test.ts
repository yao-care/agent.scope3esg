import { describe, it, expect } from 'vitest';
import { buildSupplierLinksMarkdown } from '../../src/github/supplier-links';

const suppliers = [
  { id: 'SUP001', name: '台鋼', contact: 'esg@twsteel.com', pull_api: null, pull_schedule: null, pull_api_token: null },
  { id: 'SUP002', name: '台達電', contact: 'carbon@delta.com', pull_api: null, pull_schedule: null, pull_api_token: null },
];

describe('buildSupplierLinksMarkdown', () => {
  it('renders a row with the form URL for each supplier that has a token', () => {
    const md = buildSupplierLinksMarkdown('https://w.example.com', 'acme-corp', suppliers, {
      SUP001: 'stok_aaa',
      SUP002: 'stok_bbb',
    });
    expect(md).toContain('https://w.example.com/submit/acme-corp/stok_aaa');
    expect(md).toContain('https://w.example.com/submit/acme-corp/stok_bbb');
    expect(md).toContain('台鋼');
    expect(md).toContain('SUP002');
  });
  it('shows a placeholder when a supplier has no token yet', () => {
    const md = buildSupplierLinksMarkdown('https://w.example.com', 'acme-corp', suppliers, { SUP001: 'stok_aaa' });
    expect(md).toContain('https://w.example.com/submit/acme-corp/stok_aaa');
    expect(md).toContain('尚未產生');
  });
  it('includes a confidentiality warning', () => {
    const md = buildSupplierLinksMarkdown('https://w.example.com', 'acme-corp', suppliers, {});
    expect(md).toMatch(/機密|請勿公開/);
  });
});
