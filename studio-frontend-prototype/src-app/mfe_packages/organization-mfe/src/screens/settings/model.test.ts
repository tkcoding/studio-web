import { describe, expect, it } from 'vitest';
import { MAX_LOGO_BYTES, base64Of, logoProblem, logoSrc, modeAction } from './model';

describe('organization settings model', () => {
  it('takes a small image as a logo and refuses other types and big files', () => {
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(logoProblem({ type: 'image/svg+xml', size: 1000 })).toEqual({ kind: 'type' });
    expect(logoProblem({ type: 'image/jpeg', size: MAX_LOGO_BYTES + 1 })).toEqual({ kind: 'size', sizeKb: 257, maxKb: 256 });
  });

  it('encodes bytes as base64 and a logo as a data address', () => {
    expect(base64Of(new TextEncoder().encode('Studio'))).toBe('U3R1ZGlv');
    expect(base64Of(new Uint8Array(0x10001)).length).toBe(Math.ceil(0x10001 / 3) * 4);
    expect(logoSrc({ content_type: 'image/png', data: 'AAA' })).toBe('data:image/png;base64,AAA');
  });

  it('asks before raising the barrier, lowers it plainly, and leaves a foreign self-managed one to its inside', () => {
    expect(modeAction(false, false)).toEqual({ kind: 'request', target: 'self_managed', confirm: true });
    expect(modeAction(true, true)).toEqual({ kind: 'request', target: 'managed', confirm: false });
    expect(modeAction(true, false)).toEqual({ kind: 'inside' });
  });
});
