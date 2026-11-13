/** Table or tiles, remembered per person.
 *
 *  Every list in Studio is a table because a table was the first thing that
 *  worked, not because a table is what every list wants: a wall of
 *  repositories reads better as cards, and a queue of fifty specs does not.
 *  So each list offers both, and which one somebody picked follows them to the
 *  next machine — it is a preference about them, not about the browser they
 *  happened to open.
 *
 *  Three storage layers, in the order they answer:
 *
 *  1. **React state** — what this tab is showing right now.
 *  2. **`localStorage`** — read synchronously on mount, so a reload paints the
 *     chosen view immediately instead of flashing the default and snapping.
 *     A cache, never the record: it is per-browser and can come back empty.
 *  3. **The `studio-user` gear** — the record. One map per person, written
 *     whole, read once per session.
 *
 *  Writes are debounced and last-write-wins. Two tabs disagreeing leaves the
 *  slower one's choice stored, which is the same outcome as the person having
 *  clicked in that order.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { api } from "./api";

export type ViewMode = "table" | "tiles";

/** Where the browser-local mirror lives. Versioned so a future change of shape
 *  does not have to guess what an old value meant. */
const CACHE_KEY = "studio.ui-preferences.v1";

/** How long after the last click the preference is sent. Long enough that
 *  toggling back and forth is one request, short enough that closing the tab
 *  straight afterwards still saves. */
const SAVE_DEBOUNCE_MS = 500;

interface PreferenceStore {
  prefs: Record<string, string>;
  set: (key: string, value: string) => void;
}

const Ctx = createContext<PreferenceStore | null>(null);

/** Read the browser mirror. Wrapped because every accessor here can throw —
 *  a private window, blocked site data — and a remembered view is never worth
 *  a blank screen. */
function readCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeCache(prefs: Record<string, string>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    // Out of quota, or storage denied. The gear still has it.
  }
}

export function ViewModePreferences({ token, children }: { token: string; children: ReactNode }) {
  // Seeded from the mirror so the very first render is already the chosen
  // view. The gear's answer arrives a moment later and wins.
  const [prefs, setPrefs] = useState<Record<string, string>>(readCache);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once the gear has answered. Until then a save would be racing the
   *  load and could store a map built from a stale mirror. */
  const loaded = useRef(false);

  useEffect(() => {
    let alive = true;
    api
      .uiPreferences(token)
      .then((stored) => {
        if (!alive) return;
        loaded.current = true;
        // The gear is the record, so it replaces the mirror rather than
        // merging into it — otherwise a preference cleared on another machine
        // would keep coming back from this browser's cache.
        setPrefs(stored);
        writeCache(stored);
      })
      .catch(() => {
        // Gear unreachable, or an older backend without the endpoint. The
        // mirror carries the session; nothing is saved until it answers, so a
        // failed read cannot overwrite what is stored.
        if (alive) loaded.current = false;
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const set = useCallback(
    (key: string, value: string) => {
      setPrefs((current) => {
        if (current[key] === value) return current;
        const next = { ...current, [key]: value };
        writeCache(next);
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          pending.current = null;
          if (!loaded.current) return;
          void api.saveUiPreferences(token, next).catch(() => {
            // The choice still holds for this session and this browser. It is
            // a view preference; failing loudly would be worse than quietly.
          });
        }, SAVE_DEBOUNCE_MS);
        return next;
      });
    },
    [token],
  );

  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const value = useMemo(() => ({ prefs, set }), [prefs, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The view somebody chose for one list, and how to change it.
 *
 *  `key` names the list, not the screen: `sources.view` is the same choice
 *  wherever sources are listed. Outside a provider it still works, holding the
 *  choice for the life of the component — a list must not need a context to
 *  render.
 */
export function useViewMode(
  key: string,
  fallback: ViewMode = "table",
): [ViewMode, (mode: ViewMode) => void] {
  const store = useContext(Ctx);
  const [local, setLocal] = useState<ViewMode>(fallback);
  const stored = store?.prefs[key];
  const mode: ViewMode = store ? (stored === "tiles" || stored === "table" ? stored : fallback) : local;
  const setMode = useCallback(
    (next: ViewMode) => {
      if (store) store.set(key, next);
      else setLocal(next);
    },
    [store, key],
  );
  return [mode, setMode];
}

/** Any other remembered choice — the theme, the language — kept with the
 *  views in the person's one preference record (`studio-user`
 *  `/me/ui-preferences`), so there is a single place a preference lives and a
 *  single writer of it. `""` reads as `fallback`. */
export function usePreference(key: string, fallback = ""): [string, (value: string) => void] {
  const store = useContext(Ctx);
  const [local, setLocal] = useState(fallback);
  const value = store ? store.prefs[key] || fallback : local;
  const set = useCallback(
    (next: string) => {
      if (store) store.set(key, next);
      else setLocal(next);
    },
    [store, key],
  );
  return [value, set];
}

/** How many rows a page of one list shows, remembered the same way as the
 *  view: a preference about the person, so not in the address — a shared link
 *  opens at the reader's own size. `key` is `<list>.size`. A stored value that
 *  is not one of `allowed` (an option since removed) reads as the fallback. */
export function usePageSize(
  key: string,
  fallback: number,
  allowed: readonly number[],
): [number, (size: number) => void] {
  const store = useContext(Ctx);
  const [local, setLocal] = useState<number>(fallback);
  const stored = Number(store?.prefs[key]);
  const size = store ? (allowed.includes(stored) ? stored : fallback) : local;
  const setSize = useCallback(
    (next: number) => {
      if (store) store.set(key, String(next));
      else setLocal(next);
    },
    [store, key],
  );
  return [size, setSize];
}

/** The two-button control. Icon-only, because it sits next to a heading and a
 *  word would compete with it; the label is on the title for anyone who needs
 *  it and for a screen reader. */
export function ViewToggle({
  mode,
  onChange,
  className,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  className?: string;
}) {
  return (
    <div className={`view-toggle ${className ?? ""}`} role="group" aria-label="View">
      <button
        type="button"
        className={mode === "table" ? "on" : ""}
        aria-pressed={mode === "table"}
        title="Show as a table"
        onClick={() => onChange("table")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2 3.5h2M2 8h2M2 12.5h2M6.5 3.5H14M6.5 8H14M6.5 12.5H14"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
        <span className="sr-only">Table</span>
      </button>
      <button
        type="button"
        className={mode === "tiles" ? "on" : ""}
        aria-pressed={mode === "tiles"}
        title="Show as tiles"
        onClick={() => onChange("tiles")}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
        <span className="sr-only">Tiles</span>
      </button>
    </div>
  );
}

/** One tile. Deliberately the same shape everywhere: a name, a line under it,
 *  a few numbers, and whatever the list puts in its footer. A grid of cards
 *  that each look different is harder to scan than the table it replaced. */
export function Tile({
  title,
  subtitle,
  icon,
  stats,
  footer,
  onClick,
  tone,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  /** Up to about four. More than that and the table was the right answer. */
  stats?: { label: string; value: ReactNode }[];
  footer?: ReactNode;
  onClick?: () => void;
  tone?: string;
}) {
  const clickable = typeof onClick === "function";
  return (
    <div
      className={`vtile ${tone ?? ""} ${clickable ? "clickable" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="vtile-head">
        {icon && <span className="vtile-icon">{icon}</span>}
        <div className="vtile-name">{title}</div>
      </div>
      {subtitle && <div className="vtile-sub">{subtitle}</div>}
      {stats && stats.length > 0 && (
        <div className="vtile-stats">
          {stats.map((s) => (
            <div key={s.label} className="vtile-stat">
              <div className="vtile-stat-v">{s.value}</div>
              <div className="vtile-stat-l">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {footer && <div className="vtile-foot">{footer}</div>}
    </div>
  );
}

/** The grid the tiles sit in. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <div className="vtiles">{children}</div>;
}
