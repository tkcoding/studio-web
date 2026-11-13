import { describe, expect, it } from 'vitest';
import { typeAbsence } from './typeAbsent';

/** A transport error the way the API client throws one, with the gear's problem document. */
const refused = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

describe('typeAbsence', () => {
  it('reads a dormant type from the precondition violation, with its kit', () => {
    const error = refused(400, {
      title: 'Failed precondition',
      context: {
        violations: [
          { type: 'DOMAIN_TYPE_DORMANT', subject: 'project-lifecycle', description: 'milestone is dormant' },
        ],
      },
    });
    expect(typeAbsence(error)).toEqual({ reason: 'dormant', kit: 'project-lifecycle' });
  });

  it('reads a type not installed here from the resource the not-found names', () => {
    const error = refused(404, {
      title: 'Not found',
      detail: 'milestone is not installed',
      context: { resource_type: 'DOMAIN_TYPE_NOT_INSTALLED:project-lifecycle' },
    });
    expect(typeAbsence(error)).toEqual({ reason: 'not_installed', kit: 'project-lifecycle' });
  });

  it('reads the code from a bare message too', () => {
    expect(typeAbsence(new Error('DOMAIN_TYPE_NOT_INSTALLED: project-lifecycle'))).toEqual({
      reason: 'not_installed',
      kit: 'project-lifecycle',
    });
  });

  it('is null for every other failure', () => {
    expect(typeAbsence(refused(403, { context: { violations: [{ type: 'DOMAIN_OBJECT_ACCESS_DENIED' }] } }))).toBeNull();
    expect(typeAbsence(new Error('Network Error'))).toBeNull();
    expect(typeAbsence(undefined)).toBeNull();
  });
});
