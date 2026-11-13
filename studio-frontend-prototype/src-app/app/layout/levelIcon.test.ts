import { describe, expect, it } from 'vitest';
import type { IconName } from 'lucide-react/dynamic';
import { levelIconName } from './levelIcon';

const known = ['users', 'settings'] as IconName[];

describe('levelIconName', () => {
  it('takes the bare name of a lucide icon', () => {
    expect(levelIconName('lucide:users', known)).toBe('users');
  });

  it('drops a name from another set', () => {
    expect(levelIconName('material-symbols:group', known)).toBeUndefined();
    expect(levelIconName('users', known)).toBeUndefined();
  });

  it('drops a lucide name lucide does not have', () => {
    expect(levelIconName('lucide:userz', known)).toBeUndefined();
  });

  it('draws nothing when the manifest names no icon', () => {
    expect(levelIconName(undefined, known)).toBeUndefined();
  });
});
