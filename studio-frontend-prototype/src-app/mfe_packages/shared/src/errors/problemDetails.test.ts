import { describe, expect, it } from 'vitest';
import { refusalReason } from './problemDetails';

describe('refusalReason', () => {
  it('reads the reason a permission_denied carries', () => {
    const error = { response: { data: { detail: 'denied', context: { reason: 'PLATFORM_ADMIN_REQUIRED' } } } };
    expect(refusalReason(error)).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('is null when the gear gave none', () => {
    expect(refusalReason({ response: { data: { detail: 'x' } } })).toBeNull();
    expect(refusalReason({ response: { data: 'text' } })).toBeNull();
    expect(refusalReason(new Error('offline'))).toBeNull();
  });
});
