import { describe, expect, it } from 'vitest';
import workspaceReducer, {
  resetWorkspaceForm,
  workspaceAnnounceFailed,
  workspaceSubmitFailed,
  workspaceSubmitStarted,
} from './workspaceSlice';

const CREATED = { id: 'ws-9', name: 'Platform', orgId: 'org-1' };
const REFUSAL = { kind: 'i18n', key: 'error_announce' } as const;

const ANNOUNCE_FAILED = workspaceReducer(
  undefined,
  workspaceAnnounceFailed({ workspace: CREATED, error: REFUSAL })
);

describe('the workspace a failed announcement left behind', () => {
  it('is kept with the organization it was created under', () => {
    expect(ANNOUNCE_FAILED.created).toEqual(CREATED);
    expect(ANNOUNCE_FAILED.error).toEqual(REFUSAL);
    expect(ANNOUNCE_FAILED.submitting).toBe(false);
  });

  it('survives the retry that clears the refusal', () => {
    const retrying = workspaceReducer(ANNOUNCE_FAILED, workspaceSubmitStarted());

    expect(retrying.created).toEqual(CREATED);
    expect(retrying.error).toBeNull();
    expect(retrying.submitting).toBe(true);
  });

  it('is never invented by a refused write', () => {
    const refused = workspaceReducer(undefined, workspaceSubmitFailed(REFUSAL));

    expect(refused.created).toBeNull();
    expect(refused.error).toEqual(REFUSAL);
  });

  it('is gone when the form is opened again', () => {
    expect(workspaceReducer(ANNOUNCE_FAILED, resetWorkspaceForm()).created).toBeNull();
  });
});
