/**
 * Guards the registration of every extension in the generated aggregate.
 *
 * Why this is worth a test of its own: `bootstrapMFE` registers packages in a
 * plain loop with no per-package try/catch, and `MfeScreenContainer` renders the
 * screen domain's slot only after that promise resolves. So ONE unregisterable
 * extension anywhere in the aggregate means no screen slot at all — while the
 * drawer still lists every extension that registered before the failure. The
 * symptom is a healthy-looking menu whose every click mounts into nothing, with
 * a single console error as the only clue.
 *
 * This is not hypothetical: moving search to the overlay domain under the bare
 * base extension type produced exactly that, because GTS refuses to register an
 * instance whose type has no schema and no schema exists for the base extension
 * type. Hence `extension_overlay.v1.json`, and hence this test.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  overlayDomain,
  screenDomain,
  sidebarDomain,
  gtsPlugin,
  type MfeEntryMF,
  type Extension,
} from '@gears-frontx/react';
// Not re-exported by @gears-frontx/react — this is the contract check
// `registerExtension` runs after the type-system register succeeds.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- a test reaching the check itself, not app code
import { validateContract } from '@gears-frontx/mfes';
import { helloKitManifest } from '@frontx-test-utils/helloKitManifest';
import { SHELL_SCHEMAS } from './schemas';
import { buildStudioOverlayDomain, buildStudioScreenDomain, buildStudioSidebarDomain } from './bootstrap';
import { toManifestConfig } from './runtimeKits';
import { resolveLevelMenu, type StudioScreenExtension } from './screenLevels';
import {
  STUDIO_ACTION_ARTIFACT_OPEN,
  STUDIO_ACTION_CHAIN_DONE,
  STUDIO_ACTION_CHAIN_FAILED,
  STUDIO_ACTION_NOTIFY,
  STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT,
  STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT,
} from '@constructor-studio/mfe-shared';

/**
 * The GTS id grammar, as far as this test needs it: every `~`-separated segment
 * carries exactly five dot-separated parts, and the leading segment has one more
 * for its `gts.` prefix.
 *
 * Spelled out here rather than imported from @globaltypesystem/gts-ts, which is
 * only a transitive dependency — and worth spelling out anyway, because an id
 * that breaks this rule does not report itself as malformed. GTS derives an
 * instance's schema by trimming the last segment off a *valid* id; an invalid one
 * yields no schema id at all, and the failure surfaces as "No schema found for
 * instance", which reads like a missing schema rather than a bad name.
 */
function isWellFormedGtsId(id: string): boolean {
  return id
    .replace(/~$/, '')
    .split('~')
    .every((segment, index) => segment.split('.').length === (index === 0 ? 6 : 5));
}

type PresentedExtension = Extension & {
  presentation?: {
    label?: string;
    route?: string;
    order?: number;
    level?: string;
    placement?: string;
    section?: string;
    parentSection?: string;
    kit?: string;
  };
};

interface ManifestConfig {
  // Optional: a frame package (ADR-0021) has no remote to describe a manifest
  // for. See bootstrap.ts's MfeManifestConfig, which this mirrors.
  manifest?: { id: string };
  entries: MfeEntryMF[];
  extensions?: PresentedExtension[];
}

const manifests: ManifestConfig[] = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../public/generated-mfe-manifests.json'), 'utf8')
);

const extensions = manifests.flatMap((config) => config.extensions ?? []);
const entriesById = new Map(
  manifests.flatMap((config) => config.entries).map((entry) => [entry.id, entry])
);

/**
 * The entries whose code waits on the shell with `requestFromHost`, by package.
 * A package that starts calling it fails the test below until its entry is here
 * (the mfe-package-contract guideline says why).
 */
const REQUEST_FROM_HOST_ENTRIES: Record<string, string[]> = {
  'projects-mfe': [
    'gts.frontx.mfes.mfe.entry.v1~frontx.mfes.mfe.entry_mf.v1~constructor_studio.projects.mfe.workspace_create.v1',
  ],
};

const MFE_PACKAGES = path.resolve(__dirname, '../../mfe_packages');

/** The MFE packages whose own sources call `requestFromHost`; mfe-shared only defines it. */
function packagesCallingRequestFromHost(): string[] {
  return readdirSync(MFE_PACKAGES)
    .filter((name) => name !== 'shared' && existsSync(path.join(MFE_PACKAGES, name, 'src')))
    .filter((name) =>
      readdirSync(path.join(MFE_PACKAGES, name, 'src'), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
        .some((file) => /\brequestFromHost\(/.test(readFileSync(path.join(MFE_PACKAGES, name, 'src', file), 'utf8')))
    )
    .sort();
}

// Exactly what main.tsx registers before constructing the app.
for (const schema of SHELL_SCHEMAS) gtsPlugin.registerSchema(schema);

describe('generated MFE manifest', () => {
  it('was generated — an empty aggregate means `npm run generate:mfe-manifests` was skipped', () => {
    expect(manifests.length).toBeGreaterThan(0);
  });

  it('gives every declaration a well-formed GTS id', () => {
    // Every ~-separated segment needs exactly five dot-separated parts. A
    // four-part leaf (`constructor_studio.overlays.search.v1`) invalidates the
    // whole id, and the failure surfaces as "No schema found for instance".
    const ids = manifests.flatMap((config) => [
      ...(config.manifest ? [config.manifest.id] : []),
      ...config.entries.map((entry) => entry.id),
      ...(config.extensions ?? []).map((extension) => extension.id),
    ]);
    expect(ids.filter((id) => !isWellFormedGtsId(id))).toEqual([]);
  });

  // requestFromHost's replies come back to the entry that asked, and the runtime
  // drops a reply its target does not declare without a word: the request would
  // wait forever (domainRegistration.test shows it on a real registry).
  it('names the entries of every MFE that waits on the shell with requestFromHost', () => {
    expect(packagesCallingRequestFromHost()).toEqual(Object.keys(REQUEST_FROM_HOST_ENTRIES).sort());
  });

  it.each(Object.values(REQUEST_FROM_HOST_ENTRIES).flat())('lets %s take the replies to its requests', (id) => {
    expect(entriesById.get(id)?.actions).toEqual(
      expect.arrayContaining([STUDIO_ACTION_CHAIN_DONE, STUDIO_ACTION_CHAIN_FAILED])
    );
  });

  it('gives every declared property and action a well-formed GTS id', () => {
    // The same rule, on the ids an entry REFERS to — and this side fails later
    // and louder: a malformed property id registers fine, then throws inside
    // `updateSharedProperty` during `bootstrapMFE`, leaving no screen slot at
    // all. Which is how a four-part `…context.project.v1~` leaf got written once.
    const referenced = manifests.flatMap((config) =>
      config.entries.flatMap((entry) => [
        ...(entry.requiredProperties ?? []),
        ...(entry.optionalProperties ?? []),
        ...(entry.actions ?? []),
        ...(entry.domainActions ?? []),
      ])
    );
    expect(referenced.filter((id) => !isWellFormedGtsId(id))).toEqual([]);
  });

  it('registers every extension with the type system', () => {
    // Same order bootstrapMFE uses: manifest, entries, then extensions. A
    // frame package has no manifest to register — registerMfePackage skips
    // it the same way (bootstrap.ts).
    for (const config of manifests) {
      if (config.manifest) gtsPlugin.register(config.manifest);
      for (const entry of config.entries) gtsPlugin.register(entry);
    }
    for (const extension of extensions) {
      const name = extension.presentation?.label ?? extension.id;
      expect(
        () => gtsPlugin.register(extension),
        `type-system register failed for "${name}" — bootstrapMFE would reject and no screen slot would render`
      ).not.toThrow();
    }
  });

  describe('screen levels', () => {
    const screenExtensions = extensions.filter((ext) => ext.domain === screenDomain.id);

    it('declares a level on every screen extension', () => {
      // A screen with no level still shows up, in the organization's tabs — but
      // that fallback exists for a manifest nobody has migrated yet, not for
      // ours. Anything registered here that forgot the field would silently
      // appear one level up.
      const undeclared = screenExtensions.filter(
        (ext) => (ext.presentation as { level?: string } | undefined)?.level === undefined
      );
      expect(undeclared.map((ext) => ext.presentation?.label ?? ext.id)).toEqual([]);
    });

    it('chains every screen extension through the leveled type', () => {
      // The chain is what resolves the schema that KNOWS about `level`: an id
      // that stops at the screen type validates against a schema where the
      // field is unknown and unchecked, so a typo in the level would pass.
      const unchained = screenExtensions.filter(
        (ext) => !ext.id.includes('constructor_studio.screensets.layout.leveled_screen.v1~')
      );
      expect(unchained.map((ext) => ext.presentation?.label ?? ext.id)).toEqual([]);
    });

    it('keeps the screen domain satisfied by the longer chain', () => {
      // The screen domain pins `extensionsTypeId`, and the registry checks it
      // by prefix — one derivation further down still matches.
      for (const ext of screenExtensions) {
        expect(ext.id.startsWith(screenDomain.extensionsTypeId as string)).toBe(true);
      }
    });
  });

  describe('global search', () => {
    const searchExtension = extensions.find(
      (ext) => ext.domain === overlayDomain.id && ext.presentation?.route === '/search'
    );

    it('is contributed to the overlay domain, claiming the /search route', () => {
      expect(searchExtension).toBeDefined();
    });

    it('carries the derived overlay type, which is what has a schema', () => {
      expect(searchExtension!.id).toContain('frontx.screensets.layout.overlay.v1~');
    });

    it('satisfies the overlay domain the shell declares (place and artifact requests), so registration admits it', () => {
      const entry = entriesById.get(searchExtension!.entry);
      expect(entry).toBeDefined();
      const result = validateContract(entry!, buildStudioOverlayDomain() as typeof overlayDomain, gtsPlugin);
      // Surface the reason rather than a bare `false`.
      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it('is no longer a screen, so it cannot appear in the drawer', () => {
      const asScreen = extensions.find(
        (ext) => ext.domain === screenDomain.id && ext.presentation?.route === '/search'
      );
      expect(asScreen).toBeUndefined();
    });
  });

  describe('docked kit panels (sidebar)', () => {
    const docked = extensions.filter((ext) => ext.domain === sidebarDomain.id);
    const assistant = docked.find((ext) => ext.presentation?.kit === 'assistant');

    it('has Studio AI, the assistant kit, docked in the sidebar', () => {
      expect(assistant).toBeDefined();
    });

    it('names a kit on every docked panel: the sidebar is never the shell\'s own', () => {
      expect(docked.filter((ext) => !ext.presentation?.kit).map((ext) => ext.id)).toEqual([]);
    });

    it('carries the derived sidebar type, which is what has a schema', () => {
      for (const ext of docked) expect(ext.id).toContain('frontx.screensets.layout.sidebar.v1~');
    });

    it('satisfies the sidebar domain the shell declares, context included', () => {
      const entry = entriesById.get(assistant!.entry);
      expect(entry).toBeDefined();
      const result = validateContract(entry!, buildStudioSidebarDomain() as typeof sidebarDomain, gtsPlugin);
      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
    });
  });

  describe('selected-project property', () => {
    /**
     * What `updateSharedProperty` validates: it appends a runtime segment to the
     * property id and registers the result as an instance, so a rejected value
     * throws at the publisher rather than at the subscriber.
     */
    const publish = (value: unknown): (() => void) => () =>
      gtsPlugin.register({
        id: `${STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT}frontx.mfes.comm.runtime.v1`,
        value,
      } as never);

    it('is declared by projects-mfe, which is what makes the switcher able to steer it', () => {
      const entries = manifests.flatMap((config) => config.entries);
      const declaring = entries.filter((entry) =>
        (entry.requiredProperties ?? []).includes(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT)
      );
      // A kit's project screen (ADR-0069) reads it too; projects-mfe must stay among them.
      expect(declaring.map((entry) => entry.id)).toEqual(
        expect.arrayContaining([
          expect.stringContaining('constructor_studio.projects.mfe.main'),
          expect.stringContaining('constructor_studio.projects.mfe.sources_connect'),
        ])
      );
    });

    it('admits a tenant id', () => {
      expect(publish('9f0c1a2b-0000-0000-0000-0000000000aa')).not.toThrow();
    });

    it('admits null — organization scope is a published value, not an absent one', () => {
      // bootstrapMFE seeds exactly this; forbidding it kills the slot at startup.
      expect(publish(null)).not.toThrow();
    });

    it('rejects a value that is neither, so a wrong publish fails at the publisher', () => {
      expect(publish(42)).toThrow();
      expect(publish('')).toThrow();
    });
  });

  describe('selected-artifact property', () => {
    const publish = (value: unknown): (() => void) => () =>
      gtsPlugin.register({
        id: `${STUDIO_SHARED_PROPERTY_CONTEXT_ARTIFACT}frontx.mfes.comm.runtime.v1`,
        value,
      } as never);

    it('is declared as a domain action by projects-mfe, issues-mfe and Search, and by no other entry', () => {
      // #319: the MFE asks; the answer below is the shell's (#320). The Issues
      // kit opens a passage's document in the editor, as the prototype's tab did;
      // Search opens a file it found, from the overlay domain.
      const entries = manifests.flatMap((config) => config.entries);
      const declaring = entries.filter((entry) =>
        (entry.domainActions ?? []).includes(STUDIO_ACTION_ARTIFACT_OPEN)
      );
      expect(declaring.map((entry) => entry.id).sort()).toEqual([
        expect.stringContaining('constructor_studio.issues.mfe.main'),
        expect.stringContaining('constructor_studio.projects.mfe.main'),
        expect.stringContaining('constructor_studio.search.mfe.main'),
      ]);
    });

    it('admits what the address will carry — no projectId, that is its own property', () => {
      expect(
        publish({ artifactId: 'n-1', repository: 'group/repo', path: 'docs/a.md', kind: 'file' })
      ).not.toThrow();
    });

    it('admits null — outside the editor is a published value, not an absent one', () => {
      expect(publish(null)).not.toThrow();
    });

    it('rejects a kind the MFE does not send, and a field the address does not know', () => {
      expect(
        publish({ artifactId: 'n-1', repository: 'r', path: 'p', kind: 'spec_finding' })
      ).toThrow();
      expect(
        publish({ artifactId: 'n-1', repository: 'r', path: 'p', kind: 'file', url: 'x' })
      ).toThrow();
    });
  });

  describe('notify action', () => {
    it('is declared by the projects screen, the entry that asks for toasts', () => {
      // The shell registers an action schema only when an entry declares the
      // action, and routes nothing whose type it has not registered.
      const declaring = manifests
        .flatMap((config) => config.entries)
        .filter((entry) => (entry.domainActions ?? []).includes(STUDIO_ACTION_NOTIFY));
      expect(declaring.map((entry) => entry.id)).toEqual([
        expect.stringContaining('constructor_studio.projects.mfe.main'),
      ]);
    });

    it('has a schema the shell registers', () => {
      expect(SHELL_SCHEMAS.map((schema) => schema.$id)).toContain(`gts://${STUDIO_ACTION_NOTIFY}`);
    });
  });

  describe('levels and placement', () => {
    const screens = extensions.filter((ext) => ext.domain === screenDomain.id);

    it('pins the settings item of each level last, whatever its order says', () => {
      const settings = screens.filter((ext) => ext.presentation?.placement === 'settings');
      expect(settings.map((ext) => ext.presentation?.level).sort()).toEqual([
        'organization',
        'project',
      ]);
    });

    // The header already says whose settings they are.
    it('labels every settings item plain Settings', () => {
      const settings = screens.filter((ext) => ext.presentation?.placement === 'settings');
      expect(new Set(settings.map((ext) => ext.presentation?.label))).toEqual(new Set(['Settings']));
    });

    it('lets a hidden screen name only a section its level has', () => {
      const sectionsOf = (level: string | undefined) =>
        screens
          .filter((ext) => ext.presentation?.level === level && ext.presentation?.placement !== 'hidden')
          .map((ext) => ext.presentation?.section);
      const named = screens.filter((ext) => ext.presentation?.parentSection !== undefined);
      expect(named.length).toBeGreaterThan(0);
      for (const ext of named) {
        expect(ext.presentation?.placement).toBe('hidden');
        expect(sectionsOf(ext.presentation?.level)).toContain(ext.presentation?.parentSection);
      }
    });

    it("draws the workspace's tabs: the projects list, then the catalogue kits' screens", () => {
      // Project templates (kit project-lifecycle) and Document types (kit
      // project-specs) are the prototype's workspace catalogue tabs (ADR-0069).
      // Attributes (admin-mfe's generic screen, ADR-0066) right after Projects, as
      // the prototype's workspace band had it.
      const tabs = resolveLevelMenu(screens as StudioScreenExtension[], 'workspace');
      expect(tabs.map((ext) => ext.presentation.label)).toEqual([
        'Projects',
        'Attributes',
        'Project templates',
        'Document types',
      ]);
    });

    it("draws the project's tabs in the design's order, Specs and Sources after Artifacts", () => {
      const tabs = resolveLevelMenu(screens as StudioScreenExtension[], 'project');
      expect(tabs.map((ext) => ext.presentation.label)).toEqual([
        'Overview',
        // The Issues kit's screen (issues-mfe, order 15): right after Overview,
        // where the prototype put it — what to decide comes before the work.
        'Issues',
        'Artifacts',
        'Specs',
        // The Project domain model kit's screen (domain-model-mfe, order 31):
        // right after Specs, as in the prototype — it is made of the specs.
        // Not the Studio domain model (Admin › Domain model, ADR-0066).
        'Project domain model',
        // The Tests kit's own screen (ADR-0069), between the shell's sections.
        'Tests',
        // The Product kit's two (product-mfe): Product (product-releases) and
        // the project's Components (components), after Tests as in the prototype.
        'Product',
        'Components',
        'Sources',
        // The Releases kit's screen (order 36, ADR-0056 §4): right after Sources (35).
        'Releases',
        'Activity',
        'Timeline',
        'Team',
        // What the Studio domain model records about the project (admin-mfe's
        // generic screen, ADR-0066; the prototype drew it on Overview).
        'Attributes',
        // The project's own kits (ADR-0069 §4), before its settings.
        'Kits',
        'Settings',
      ]);
    });

    it("draws Admin's sections in the prototype's order", () => {
      const tabs = resolveLevelMenu(screens as StudioScreenExtension[], 'admin');
      expect(tabs.map((ext) => ext.presentation.label)).toEqual([
        'Organizations',
        'People',
        'Access',
        'Integrations',
        'Secrets',
        // The Studio domain model (admin-mfe, order 60, ADR-0066): before
        // Objects, where the prototype's Admin had "Domain model". Not the
        // project's "Project domain model" kit tab.
        'Studio domain model',
        'Objects',
        // Saved views of the model's objects (admin-mfe, order 80), after Objects.
        'Views',
        'All identities',
        'Project tenants',
        // The prototype's System (who is here, a test notification, raw types and JSON).
        'System',
      ]);
    });

    it('declares the project sections on the entry they are sections of', () => {
      // The editor is a project-level screen too, but hidden: no tab.
      // The generic screens (Attributes, the model's tabs, ADR-0066) are the
      // shell's too, but on every level, so they live in admin-mfe's entry.
      const project = screens.filter(
        (ext) =>
          ext.presentation?.level === 'project' &&
          ext.presentation?.placement !== 'hidden' &&
          !/\.admin\.screens\.model_project(_types)?\.v1$/.test(ext.id)
      );
      // The projects list's entry: the workspace level also holds kit screens of their own.
      const workspaceEntry = screens.find(
        (ext) => ext.presentation?.level === 'workspace' && ext.presentation?.route === '/projects'
      )?.entry;

      // The project's own sections share one entry: that is what lets the
      // shell relay a section instead of mounting eight screens. A kit's tab
      // (ADR-0069) is a screen of its own, never the shell's entry; a kit with
      // several tabs on one entry (product-mfe: Product and Components)
      // switches on sections of its own.
      // Some of the shell entry's sections belong to a kit (Artifacts, Specs,
      // Activity, Timeline): still sections of that entry, shown only where
      // their kit is installed.
      const shellSections = project.filter((ext) => ext.presentation?.section && !ext.presentation?.kit);
      expect(new Set(shellSections.map((ext) => ext.entry))).toEqual(new Set([workspaceEntry]));
      expect(shellSections.length).toBeGreaterThan(1);
      // A section elsewhere is a kit's own (it switches on sections of its own).
      for (const ext of project.filter((e) => e.presentation?.section && e.entry !== workspaceEntry)) {
        expect(ext.presentation?.kit).toBeTruthy();
      }
      // A tab with no section is a screen of its own, never the shell's entry.
      for (const tab of project.filter((e) => !e.presentation?.section)) expect(tab.entry).not.toBe(workspaceEntry);
    });

    it('gives every item sharing an entry with another of its level a section of its own', () => {
      const groups = new Map<string, PresentedExtension[]>();
      for (const ext of screens) {
        const key = `${ext.presentation?.level ?? 'organization'}\u0000${ext.entry}`;
        groups.set(key, [...(groups.get(key) ?? []), ext]);
      }

      const shared = [...groups.values()].filter((group) => group.length > 1);
      const nameOf = (ext: PresentedExtension): string => ext.presentation?.label ?? ext.id;

      const untokened = shared.flatMap((group) =>
        group.filter((ext) => !ext.presentation?.section).map(nameOf)
      );
      expect(untokened).toEqual([]);

      const duplicated = shared.flatMap((group) => {
        const seen = new Set<string>();
        return group
          .filter((ext) => {
            const section = ext.presentation?.section as string;
            if (seen.has(section)) return true;
            seen.add(section);
            return false;
          })
          .map(nameOf);
      });
      expect(duplicated).toEqual([]);
    });
  });
});

/**
 * A kit's screens arrive at run time (ADR-0068 phase 5) and are held to the
 * same contract as the built-in ones above. The demo kit
 * (`examples/kits/hello-kit`) stands for every kit: its manifest as the shell
 * turns it into a package config (`toManifestConfig`).
 */
describe('a kit manifest registered at run time', () => {
  const config = toManifestConfig(helloKitManifest(), 'https://studio.example');
  const kitExtensions = (config.extensions ?? []) as PresentedExtension[];
  const kitScreens = kitExtensions.filter((ext) => ext.domain === screenDomain.id);
  const kitEntries = config.entries as MfeEntryMF[];

  it('gives every declaration and every reference a well-formed GTS id', () => {
    const ids = [
      config.manifest!.id,
      ...kitEntries.map((entry) => entry.id),
      ...kitExtensions.map((ext) => ext.id),
      ...kitEntries.flatMap((entry) => [
        ...(entry.requiredProperties ?? []),
        ...(entry.optionalProperties ?? []),
        ...(entry.actions ?? []),
        ...(entry.domainActions ?? []),
      ]),
    ];
    expect(ids.filter((id) => !isWellFormedGtsId(id))).toEqual([]);
  });

  it('registers with the type system', () => {
    gtsPlugin.register(config.manifest);
    for (const entry of kitEntries) gtsPlugin.register(entry);
    for (const ext of kitExtensions) expect(() => gtsPlugin.register(ext)).not.toThrow();
  });

  it('declares a level on its screens and chains them through the leveled type', () => {
    expect(kitScreens.length).toBeGreaterThan(0);
    for (const ext of kitScreens) {
      expect(ext.presentation?.level).toBeDefined();
      expect(ext.id).toContain('constructor_studio.screensets.layout.leveled_screen.v1~');
      expect(ext.id.startsWith(screenDomain.extensionsTypeId as string)).toBe(true);
    }
  });

  it('satisfies the screen domain the shell declares', () => {
    for (const ext of kitScreens) {
      const entry = kitEntries.find((e) => e.id === ext.entry)!;
      const result = validateContract(entry, buildStudioScreenDomain(), gtsPlugin);
      expect(result.errors ?? []).toEqual([]);
      expect(result.valid).toBe(true);
    }
  });

  it('is gated by its own kit, whatever the bundle says', () => {
    const lying = helloKitManifest();
    const raw = lying.config as { extensions: Array<{ presentation: Record<string, unknown> }> };
    raw.extensions[0].presentation.kit = 'project-tests';
    const gated = toManifestConfig(lying, 'https://studio.example');
    expect(gated.extensions?.map((ext) => (ext as { presentation?: { kit?: string } }).presentation?.kit)).toEqual(raw.extensions.map(() => 'hello-kit'));
  });

  it('takes no route and no GTS package a built-in screen has', () => {
    const builtInRoutes = new Set(extensions.map((ext) => ext.presentation?.route));
    expect(kitScreens.filter((ext) => builtInRoutes.has(ext.presentation?.route))).toEqual([]);
    const pkg = (id: string) => id.split('~').pop()!.split('.').slice(0, 2).join('.');
    const builtInPackages = new Set(extensions.map((ext) => pkg(ext.id)));
    expect(kitExtensions.filter((ext) => builtInPackages.has(pkg(ext.id)))).toEqual([]);
  });

  it('shows its tab among the project tabs, by its order, before Settings', () => {
    const screens = [...extensions, ...kitScreens].filter((ext) => ext.domain === screenDomain.id);
    const tabs = resolveLevelMenu(screens as StudioScreenExtension[], 'project').map((ext) => ext.presentation.label);
    expect(tabs).toContain('Hello');
    expect(tabs[tabs.length - 1]).toBe('Settings');
  });

  it('refuses a bundle that owns a domain or carries a frame', () => {
    const withDomain = helloKitManifest();
    (withDomain.config as Record<string, unknown>).domains = [{ id: 'gts.x.y.z.domain.v1~a.b.c.d.v1' }];
    expect(() => toManifestConfig(withDomain, 'https://studio.example')).toThrow(/domain/);
    const framed = helloKitManifest();
    const entries = (framed.config as { entries: Array<Record<string, unknown>> }).entries;
    entries[0].id = 'gts.frontx.mfes.mfe.entry.v1~constructor_studio.mfes.mfe.entry_iframe.v1~example.hello_kit.mfe.main.v1';
    expect(() => toManifestConfig(framed, 'https://studio.example')).toThrow(/frame/);
  });
});
