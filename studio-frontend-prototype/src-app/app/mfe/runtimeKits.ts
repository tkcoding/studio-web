/**
 * Kit micro-frontends registered at run time (ADR-0068 phase 5).
 *
 * A built-in screen arrives with the portal's build (`generated-mfe-manifests.json`).
 * A kit's screen arrives when the kit applies: `studio-kits` lists the
 * micro-frontend packages of the kits effective in the scope
 * (`GET /studio-kits/v1/mfe-manifests`), each with its build's
 * `mfe-manifest.json` and where its files are served. This module does in the
 * browser what the build-time generator (`scripts/lib/manifest-generator.ts`)
 * does for a built-in package — the public path goes in, the manifest is inlined
 * into each entry — and registers the result into the same registry through
 * the same `registerMfePackage`, so GTS validation, levels, placement, order and
 * the `kit` gate apply alike. No portal rebuild.
 *
 * What a runtime package may not do, that a built-in one may:
 * - own a domain (`domains`), or carry a frame entry (ADR-0021): only
 *   Module Federation entries, mounted into the shell's own domains;
 * - take an id or a route the shell already has: a kit cannot stand in for a
 *   built-in screen;
 * - register a schema the type system already knows: a kit adds types, it
 *   does not redefine the shell's;
 * - show outside its kit: every extension's `presentation.kit` is the kit's
 *   own slug, whatever the bundle says, so `screenShows` hides it wherever the
 *   kit is not installed.
 *
 * - contribute to a domain the shell does not have: a kit's sections go into
 *   the shell's named slots (`mfe/slots.ts`), not into domains of its own.
 *
 * A package that fails any of this, or does not read, is a failure on the
 * error tile (`layout/RuntimeKits.tsx`) and is not registered; the rest of
 * the shell goes on. So is a runtime screen that does not mount.
 *
 * The lifecycle (issue #1006):
 * - `sync` is the desired state of the scope in view: a package listed at a
 *   new revision (version or `base_path`) replaces its registration, and a
 *   package no longer listed is unregistered — uninstalling takes its tabs and
 *   sections out, and the runtime releases whatever of it was mounted.
 * - A remote the page already loaded is forgotten when its extension comes
 *   back at another revision (`forgetLoadedRemote`), so the new version mounts
 *   without a page reload.
 * - `begin` / `settle` say whether the kits of a scope have been registered
 *   yet. Routing (`routing/materialize.ts`) waits on that before it calls an
 *   address unknown, so a cold deep link to a kit's screen opens it.
 */

import {
  FRONTX_MFE_ENTRY_MF,
  extractGtsPackage,
  screenDomain,
  type MfeRegistry,
  type MfManifest,
} from '@gears-frontx/react';
import { prewarmShadowStyles } from '@constructor-studio/mfe-shared';
import { mfeStylesheetHrefs, registerMfePackage, type MfeManifestConfig } from '@/app/mfe/bootstrap';
import { forgetLoadedRemote } from '@/app/mfe/remoteCache';
import { tokenOf } from '@/app/routing/screenTokens';
import type { StudioScreenExtension } from '@/app/mfe/screenLevels';
import type { KitMfeManifest } from '@/app/api/InstalledKitsApiService';

export type { KitMfeManifest };

/** Something of a kit that did not come up. */
export interface RuntimeKitFailure {
  /** `<kit>/<package>`: one tile per package. */
  key: string;
  kit: string;
  version: string;
  package: string;
  /** The screen that did not mount, when it was a mount. */
  label?: string;
  reason: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

const keyOf = (item: Pick<KitMfeManifest, 'kit_slug' | 'package'>): string => `${item.kit_slug}/${item.package}`;

/**
 * What one registration of a package is: its version and where its files are.
 * `base_path` is opaque to the shell; a source that pins a commit (an
 * organization's repository, ADR-0068 phase 7) changes it without changing
 * the version, and that is a new revision too.
 */
const revisionOf = (item: Pick<KitMfeManifest, 'version' | 'base_path'>): string => `${item.version}@${item.base_path}`;

/**
 * The scope the runtime kits are read for, as the loader and routing both
 * name it: the open project, else the organization in view.
 */
export function runtimeScopeKey(scope: { project?: string | null; org?: string | null }): string | null {
  if (scope.project) return `project:${scope.project}`;
  if (scope.org) return `organization:${scope.org}`;
  return null;
}

/** A screen a runtime kit brought, remembered after the kit went: what "not available here" names. */
export interface KnownRuntimeScreen {
  kit: string;
  label: string;
}

/** One field of an extension's `presentation`, which the SDK types do not carry. */
const presented = (extension: unknown, field: 'route' | 'label'): unknown =>
  (extension as { presentation?: Record<string, unknown> }).presentation?.[field];

/** The schema id a JSON schema's `$id` names, without its `gts://` scheme. */
const schemaTypeId = ($id: string): string => $id.replace(/^gts:\/\//, '');

/**
 * The config `registerMfePackage` takes, from one listed package: what the
 * build-time generator writes for a built-in one, with `base_path` as the
 * public path. Throws with the reason when the package is not one a kit may
 * bring.
 */
export function toManifestConfig(item: KitMfeManifest, origin: string): MfeManifestConfig {
  const raw = item.config;
  if (!isObject(raw)) throw new Error(item.error || 'the bundle has no mfe-manifest.json');
  const manifest = raw.manifest;
  if (!isObject(manifest) || !isObject(manifest.metaData) || typeof manifest.id !== 'string') {
    throw new Error('mfe-manifest.json has no manifest.metaData: was the bundle built with the frontxMfGts plugin?');
  }
  if (Array.isArray(raw.domains) && raw.domains.length > 0) {
    throw new Error('a kit cannot declare a domain; its screens go into the shell’s');
  }
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) throw new Error('mfe-manifest.json has no entries');

  const outManifest = {
    id: manifest.id,
    name: manifest.name,
    metaData: { ...manifest.metaData, publicPath: new URL(item.base_path, origin).href },
    shared: Array.isArray(manifest.shared) ? manifest.shared : [],
  } as unknown as MfManifest;

  const entries = raw.entries.map((entry: unknown) => {
    if (!isObject(entry) || typeof entry.id !== 'string') throw new Error('an entry has no id');
    if (!entry.id.startsWith(FRONTX_MFE_ENTRY_MF)) {
      throw new Error(`entry ${entry.id} is not a Module Federation entry; a kit brings no frame`);
    }
    if (!isObject(entry.exposeAssets)) throw new Error(`entry ${entry.id} has no exposeAssets: rebuild the bundle`);
    return {
      id: entry.id,
      requiredProperties: entry.requiredProperties,
      ...(entry.optionalProperties !== undefined && { optionalProperties: entry.optionalProperties }),
      actions: entry.actions,
      domainActions: entry.domainActions,
      manifest: outManifest,
      exposedModule: entry.exposedModule,
      exposeAssets: entry.exposeAssets,
    };
  });
  const entryIds = new Set(entries.map((entry) => entry.id));

  const extensions = (Array.isArray(raw.extensions) ? raw.extensions : []).map((extension: unknown) => {
    if (!isObject(extension) || typeof extension.id !== 'string') throw new Error('an extension has no id');
    if (typeof extension.entry !== 'string' || !entryIds.has(extension.entry)) {
      throw new Error(`extension ${extension.id} names an entry the bundle does not have`);
    }
    const presentation = isObject(extension.presentation) ? extension.presentation : {};
    // Shown only where its own kit is installed, whatever the bundle says.
    return { ...extension, presentation: { ...presentation, kit: item.kit_slug } };
  });

  return {
    manifest: outManifest,
    entries: entries as unknown as MfeManifestConfig['entries'],
    extensions: extensions as unknown as MfeManifestConfig['extensions'],
    ...(Array.isArray(raw.schemas) && { schemas: raw.schemas as MfeManifestConfig['schemas'] }),
  };
}

/** The GTS packages (`vendor.package`) a package's manifest, entries and extensions are in. */
function packagesOf(config: MfeManifestConfig): Set<string> {
  const ids = [
    ...(config.manifest ? [config.manifest.id] : []),
    ...config.entries.map((entry) => entry.id),
    ...(config.extensions ?? []).map((ext) => ext.id),
  ];
  return new Set(ids.map((id) => extractGtsPackage(id)));
}

/** Refuse what would let a kit stand in for the shell (see the module comment). */
function checkAgainst(registry: MfeRegistry, config: MfeManifestConfig, own: ReadonlySet<string>, schemas: ReadonlyMap<string, string>): void {
  // A built-in package's ids are its own: a kit that reused one would replace
  // the built-in entry or manifest under the same id.
  const ownPackages = new Set([...own].map((id) => extractGtsPackage(id)));
  const taken = new Set(registry.getRegisteredPackages().filter((pkg) => !ownPackages.has(pkg)));
  for (const pkg of packagesOf(config)) {
    if (taken.has(pkg)) throw new Error(`the GTS package ${pkg} belongs to a screen the shell already has`);
  }
  const routes = new Map<string, string>();
  for (const ext of registry.getExtensionsForDomain(screenDomain.id)) {
    const route = presented(ext, 'route');
    if (typeof route === 'string' && !own.has(ext.id)) routes.set(route, ext.id);
  }
  for (const extension of config.extensions ?? []) {
    // `registerMfePackage` skips an extension of a domain the host does not
    // own; for a kit that is a section that would silently never show.
    if (!registry.getDomain(extension.domain)) {
      throw new Error(`extension ${extension.id} goes into ${extension.domain}, which is not a slot the shell has`);
    }
    if (registry.getExtension(extension.id) && !own.has(extension.id)) {
      throw new Error(`extension ${extension.id} is already registered`);
    }
    const route = presented(extension, 'route');
    if (typeof route === 'string' && routes.has(route)) {
      throw new Error(`route ${route} is already the screen ${routes.get(route)}`);
    }
  }
  for (const schema of config.schemas ?? []) {
    if (schema.$id && registry.typeSystem.getSchema(schemaTypeId(schema.$id))) {
      if (schemas.get(schemaTypeId(schema.$id)) === JSON.stringify(schema)) continue;
      throw new Error(`schema ${schema.$id} is already registered; a kit adds types, it does not redefine them`);
    }
  }
}

interface Registered {
  version: string;
  revision: string;
  ids: string[];
  schemas: Map<string, string>;
  extensionIds: string[];
  labels: Map<string, string>;
}

/** Whether `extension` is a screen (it has a route), and its token. */
function screenTokenOf(extension: unknown): string | undefined {
  const route = presented(extension, 'route');
  return typeof route === 'string' ? tokenOf(extension as StudioScreenExtension) : undefined;
}

/**
 * The runtime packages of one registry, what did not come up, and whether the
 * kits of the scope in view have been registered yet.
 *
 * One `subscribe` hears every change: a failure, a registration or removal
 * (`revision()` moves), and a scope beginning or settling.
 */
export class RuntimeKits {
  private readonly registered = new Map<string, Registered>();
  /**
   * The revision each runtime extension was last registered at, kept after
   * it is unregistered: the same revision coming back reuses what the page
   * loaded, another one loads afresh.
   */
  private readonly loadedAt = new Map<string, string>();
  /** Screens runtime kits brought, by route token, remembered after they go. */
  private readonly known = new Map<string, KnownRuntimeScreen>();
  private failureList: RuntimeKitFailure[] = [];
  private readonly listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  private scope: string | null = null;
  private scopeSettled = false;
  private changes = 0;

  constructor(private readonly registry: MfeRegistry) {}

  /**
   * Make the registry hold what `items` lists, at the revisions listed: a
   * package listed at a new revision replaces its registration, and a package
   * no longer listed is unregistered (the kit was uninstalled, or the person
   * moved to a scope where it is not installed). A package whose new revision
   * is refused keeps its old registration and says why on its tile.
   */
  sync(items: readonly KitMfeManifest[], origin: string): Promise<void> {
    const next = this.pending.then(() => this.syncNow(items, origin));
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async syncNow(items: readonly KitMfeManifest[], origin: string): Promise<void> {
    const failures = new Map(this.failureList.map((f) => [f.key, f]));
    const listed = new Set(items.map(keyOf));
    let changed = false;

    for (const [key, registered] of [...this.registered]) {
      if (listed.has(key)) continue;
      await this.unregister(registered.extensionIds);
      this.registered.delete(key);
      failures.delete(key);
      changed = true;
    }
    for (const key of [...failures.keys()]) {
      // A package that is no longer listed has nothing left to say.
      if (!listed.has(key) && !this.registered.has(key)) failures.delete(key);
    }

    for (const item of items) {
      const key = keyOf(item);
      const revision = revisionOf(item);
      const current = this.registered.get(key);
      if (current?.revision === revision) continue;
      failures.delete(key);
      const fail = (reason: string) =>
        failures.set(key, { key, kit: item.kit_slug, version: item.version, package: item.package, reason });
      let config: MfeManifestConfig;
      try {
        config = toManifestConfig(item, origin);
        checkAgainst(this.registry, config, new Set(current?.ids ?? []), current?.schemas ?? new Map());
      } catch (error) {
        fail(messageOf(error));
        continue;
      }
      if (current) {
        await this.unregister(current.extensionIds);
        this.registered.delete(key);
        changed = true;
      }
      const extensions = config.extensions ?? [];
      // A remote this page loaded at another revision is not the one to mount now.
      for (const ext of extensions) {
        const before = this.loadedAt.get(ext.id);
        if (before !== undefined && before !== revision) forgetLoadedRemote(ext.id);
      }
      try {
        await registerMfePackage(this.registry, config);
      } catch (error) {
        // Whatever of the package did register comes out again: half a kit
        // is not shown.
        await this.unregister(extensions.map((ext) => ext.id));
        fail(messageOf(error));
        changed = true;
        continue;
      }
      changed = true;
      for (const ext of extensions) {
        this.loadedAt.set(ext.id, revision);
        const token = screenTokenOf(ext);
        if (token) this.known.set(token, { kit: item.kit_slug, label: String(presented(ext, 'label') ?? token) });
      }
      this.registered.set(key, {
        version: item.version,
        revision,
        ids: [...new Set([
          ...(current?.ids ?? []),
          ...(config.manifest ? [config.manifest.id] : []),
          ...config.entries.map((entry) => entry.id),
          ...extensions.map((ext) => ext.id),
        ])],
        schemas: new Map([
          ...(current?.schemas ?? []),
          ...(config.schemas ?? []).flatMap((schema): [string, string][] => schema.$id ? [[schemaTypeId(schema.$id), JSON.stringify(schema)]] : []),
        ]),
        extensionIds: extensions.map((ext) => ext.id),
        labels: new Map(
          extensions.map((ext) => [ext.id, String(presented(ext, 'label') ?? ext.id)])
        ),
      });
      prewarmShadowStyles(mfeStylesheetHrefs([config]));
    }
    if (changed) this.changes += 1;
    if (!this.setFailures([...failures.values()]) && changed) this.emit();
  }

  /**
   * The kits of `scope` are being read: until `settle(scope)`, an address
   * naming a screen nobody has registered waits instead of being called
   * unknown. A scope begun again (its kits changed) waits again.
   */
  begin(scope: string): void {
    if (this.scope === scope && !this.scopeSettled) return;
    this.scope = scope;
    this.scopeSettled = false;
    this.emit();
  }

  /** The kits of `scope` are registered, or it was found there are none to register. */
  settle(scope: string): void {
    if (this.scope !== scope || this.scopeSettled) return;
    this.scopeSettled = true;
    this.emit();
  }

  /** Whether the kits of `scope` have been registered (or found to be none). */
  isSettled(scope: string): boolean {
    return this.scope === scope && this.scopeSettled;
  }

  /** Moves whenever a runtime package is registered or unregistered. */
  revision(): number {
    return this.changes;
  }

  /** The kit and label of a screen a runtime kit brought at `token`, even after it went. */
  knownScreen(token: string): KnownRuntimeScreen | undefined {
    return this.known.get(token);
  }

  /** A runtime screen did not mount: on the tile. Not a runtime screen: nothing. */
  mountFailed(extensionId: string, reason: string): void {
    for (const [key, registered] of this.registered) {
      if (!registered.extensionIds.includes(extensionId)) continue;
      const [kit, pkg] = key.split('/');
      const failure: RuntimeKitFailure = {
        key,
        kit,
        version: registered.version,
        package: pkg,
        label: registered.labels.get(extensionId),
        reason,
      };
      this.setFailures([...this.failureList.filter((f) => f.key !== key), failure]);
      return;
    }
  }

  /** Whether `extensionId` came from a kit at run time. */
  isRuntime(extensionId: string): boolean {
    return [...this.registered.values()].some((r) => r.extensionIds.includes(extensionId));
  }

  failures(): readonly RuntimeKitFailure[] {
    return this.failureList;
  }

  dismiss(key: string): void {
    this.setFailures(this.failureList.filter((f) => f.key !== key));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** Replaces the failures and tells the listeners; `false` when nothing changed. */
  private setFailures(next: RuntimeKitFailure[]): boolean {
    const same =
      next.length === this.failureList.length &&
      next.every((f, i) => {
        const o = this.failureList[i];
        return o.key === f.key && o.reason === f.reason && o.version === f.version && o.label === f.label;
      });
    if (same) return false;
    this.failureList = next;
    this.emit();
    return true;
  }

  private async unregister(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      if (!this.registry.getExtension(id)) continue;
      try {
        // The runtime releases the extension wherever it is mounted.
        await this.registry.unregisterExtension(id);
      } catch (error) {
        console.warn(`[Runtime kits] could not unregister ${id}: ${messageOf(error)}`);
      }
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const perRegistry = new WeakMap<MfeRegistry, RuntimeKits>();

/** The runtime kits of `registry`: one per registry, as `occupancyOf` is. */
export function runtimeKitsOf(registry: MfeRegistry): RuntimeKits {
  let kits = perRegistry.get(registry);
  if (!kits) {
    kits = new RuntimeKits(registry);
    perRegistry.set(registry, kits);
  }
  return kits;
}
