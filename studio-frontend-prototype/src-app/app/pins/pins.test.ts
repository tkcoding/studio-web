/* The prototype's pins.test.ts, over the address-shaped pin. The two failure
 * shapes are the same: a pin that silently replaces another, and defaults that
 * come back after somebody deliberately cleared them. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PINS, PINS_KEY, isPinned, loadPins, parsePins, pinKey, savePins, togglePin, type Pin } from './pins';

const section = (token: string, section?: string, where: string[] = ['Acme']): Pin => ({
  route: { token, org: 'o1', ...(section ? { section } : {}) },
  label: token,
  where,
});
const project = (project: string, sectionName: string, name = 'Shop'): Pin => ({
  route: { token: 'projects', org: 'o1', workspace: 'w1', project, section: sectionName },
  label: sectionName,
  where: ['Acme', 'Work', name],
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

describe('pinKey', () => {
  it('tells two sections of the same project apart', () => {
    expect(pinKey(project('p1', 'specs'))).not.toBe(pinKey(project('p1', 'team')));
  });

  it('ignores the cached names, which are labels and not an identity', () => {
    expect(pinKey(project('p1', 'specs', 'Shop'))).toBe(pinKey(project('p1', 'specs', 'Renamed')));
  });

  it('tells the same section of two organizations apart', () => {
    const other: Pin = { ...section('people'), route: { token: 'people', org: 'o2' } };
    expect(pinKey(section('people'))).not.toBe(pinKey(other));
  });
});

describe('togglePin', () => {
  it('appends rather than prepends', () => {
    const pins = togglePin([section('a'), section('b')], section('c'));
    expect(pins.map((p) => p.route.token)).toEqual(['a', 'b', 'c']);
  });

  it('removes what is already pinned', () => {
    const pins = togglePin([section('a'), section('b')], section('a'));
    expect(pins.map((p) => p.route.token)).toEqual(['b']);
  });

  it('matches on identity, so a renamed project unpins itself', () => {
    expect(togglePin([project('p1', 'specs', 'Shop')], project('p1', 'specs', 'Renamed'))).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const before: Pin[] = [section('a')];
    togglePin(before, section('b'));
    expect(before).toEqual([section('a')]);
  });
});

describe('isPinned', () => {
  it('answers on identity rather than on object equality', () => {
    expect(isPinned([project('p1', 'specs', 'Shop')], project('p1', 'specs', 'Renamed'))).toBe(true);
    expect(isPinned([section('a')], section('b'))).toBe(false);
  });
});

describe('parsePins', () => {
  it('keeps what it understands and drops the rest, one entry at a time', () => {
    const raw = [
      section('a'),
      { route: { token: '' }, label: 'x' },
      { route: { token: 'b', org: 7 }, label: 'b' },
      { route: { token: 'c' } },
      'nonsense',
      null,
      { kind: 'view', id: 'projects' }, // the prototype's shape
      project('p1', 'specs'),
    ];
    expect(parsePins(raw).map(pinKey)).toEqual([pinKey(section('a')), pinKey(project('p1', 'specs'))]);
  });

  it('drops a duplicate', () => {
    expect(parsePins([section('a'), section('a')])).toHaveLength(1);
  });

  it('keeps only the names in where', () => {
    expect(parsePins([{ ...section('a'), where: ['Acme', 3] }])[0].where).toEqual(['Acme']);
  });

  it('reads a non-list as nothing', () => {
    expect(parsePins({ pins: [] })).toEqual([]);
  });
});

describe('loadPins / savePins', () => {
  it('falls back to the defaults only when nothing was ever saved', () => {
    expect(loadPins(memoryStorage())).toEqual([...DEFAULT_PINS]);
  });

  it('keeps an empty saved list empty', () => {
    expect(loadPins(memoryStorage({ [PINS_KEY]: '[]' }))).toEqual([]);
  });

  it('survives what is not JSON', () => {
    expect(loadPins(memoryStorage({ [PINS_KEY]: '{oops' }))).toEqual([...DEFAULT_PINS]);
  });

  it('round-trips', () => {
    const storage = memoryStorage();
    savePins([section('a'), project('p1', 'specs')], storage);
    expect(loadPins(storage)).toEqual([section('a'), project('p1', 'specs')]);
  });

  it('does not throw where storage is refused', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadPins(refusing)).toEqual([...DEFAULT_PINS]);
    expect(() => savePins([section('a')], refusing)).not.toThrow();
  });
});
