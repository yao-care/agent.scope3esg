import { describe, it, expect } from 'vitest';
import { renderNav } from '../../src/ui/nav';

describe('renderNav', () => {
  it('renders four nav links with org-scoped hrefs', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain('href="/admin/acme"');
    expect(html).toContain('href="/admin/acme/review"');
    expect(html).toContain('href="/dashboard/acme"');
    expect(html).toContain('href="/admin/acme/reports"');
  });

  it('marks the active item with the active class', () => {
    expect(renderNav('acme', 'dashboard')).toMatch(/class="nav-link active" href="\/dashboard\/acme"/);
    expect(renderNav('acme', 'config')).toMatch(/class="nav-link active" href="\/admin\/acme"/);
  });

  it('includes logout button and pending badge placeholder', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain('id="nav-logout"');
    expect(html).toContain('id="nav-pending"');
  });

  it('fetches the review count and posts logout for the given org', () => {
    const html = renderNav('acme', 'config');
    expect(html).toContain("/api/v1/admin/'+org+'/review/count");
    expect(html).toContain("/admin/'+org+'/logout");
    expect(html).toContain('"acme"');
  });

  it('escapes org in attribute context', () => {
    const html = renderNav('a"b', 'config');
    expect(html).not.toContain('href="/admin/a"b"');
  });
});
