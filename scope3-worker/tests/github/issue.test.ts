import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSubmissionIssue } from '../../src/github/issue';
import type { Submission } from '../../src/types';

const mockOctokit = { request: vi.fn() };

const submission: Submission = {
  submission_id:    'sub-uuid-001',
  supplier_id:      'SUP001',
  supplier_name:    '台灣鋼鐵股份有限公司',
  scope3_category:  1,
  period:           '2025-Q1',
  activity_type:    'electricity',
  amount:           10000,
  unit:             'kWh',
  evidence_urls:    [],
  submitted_at:     '2025-05-25T08:00:00Z',
  channel:          'form',
  emission_factor_id: null,
  calculated_co2e:    null,
};

describe('createSubmissionIssue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates issue with correct title, labels, and JSON body', async () => {
    mockOctokit.request.mockResolvedValue({ data: { number: 42 } });

    const issueNumber = await createSubmissionIssue(mockOctokit as any, 'acme-corp', submission);

    expect(issueNumber).toBe(42);
    expect(mockOctokit.request).toHaveBeenCalledWith(
      'POST /repos/{owner}/{repo}/issues',
      expect.objectContaining({
        owner: 'acme-corp',
        repo:  'scope3-inventory',
        labels: expect.arrayContaining(['status:submitted', 'cat:1']),
      }),
    );

    const callArgs = mockOctokit.request.mock.calls[0][1];
    expect(callArgs.body).toContain('sub-uuid-001');
    expect(callArgs.body).toContain('台灣鋼鐵股份有限公司');
  });
});
