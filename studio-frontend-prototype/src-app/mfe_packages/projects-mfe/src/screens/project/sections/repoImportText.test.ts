import { describe, expect, it } from 'vitest';
import { screenText, type Refusal } from '@constructor-studio/mfe-shared';
import type { RepoImport, RepoImportStatus } from '../../../slices/artifactSyncSlice';
import { notComeThrough, repoImportLine } from './repoImportText';

const t = screenText((key, params) => (params ? `${params.repo}: ${params.reason}` : `<${key}>`), 'en');

function row(status: RepoImportStatus, reason: Refusal | null = null): RepoImport {
  return {
    repo: 'acme/api',
    runId: 'r-1',
    status,
    phase: null,
    summary: null,
    reason,
    stored: 0,
    cancelling: false,
    refusal: null,
  };
}

describe('repoImportLine', () => {
  it("says the portal's own reason in the member's language", () => {
    const line = repoImportLine(t, row('failed', { kind: 'i18n', key: 'artifacts_reason_request_failed' }));
    expect(line).toBe('acme/api: <artifacts_reason_request_failed>');
  });

  it("says the provider's reason as it was said", () => {
    expect(repoImportLine(t, row('failed', { kind: 'provider', text: 'rate limited' }))).toBe('acme/api: rate limited');
  });

  it('says a cancelled sync with no reason was cancelled, not failed', () => {
    expect(repoImportLine(t, row('cancelled'))).toBe('acme/api: <artifacts_reason_cancelled>');
  });

  it('says no reason when a failed sync has none', () => {
    expect(repoImportLine(t, row('failed'))).toBe('acme/api: ');
  });
});

describe('notComeThrough', () => {
  it.each<[RepoImportStatus, boolean]>([
    ['queued', false],
    ['running', false],
    ['succeeded', false],
    ['failed', true],
    ['cancelled', true],
    ['lost', true],
    ['unsyncable', true],
  ])('is %s → %s', (status, expected) => {
    expect(notComeThrough(row(status))).toBe(expected);
  });
});
