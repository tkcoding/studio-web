import { Endpoint } from '@theia/core/lib/browser/endpoint';

/** A kit in the Studio catalogue (`GET /studio-kits/v1/catalog`, snake_case as the gear writes it). */
export interface KitCatalogEntry {
    readonly slug: string;
    readonly name: string;
    readonly description: string;
    readonly publisher: string;
    readonly repository_url: string;
    readonly default_version: string;
}

/** Where a kit landed, per repository. */
export interface KitMaterializationRow {
    readonly repository_id: string;
    readonly repository_label?: string;
    readonly version: string;
    readonly status: string;
    readonly failure_reason?: string;
}

/** A kit the project asked for (`GET …/installations`). */
export interface KitInstallationRow {
    readonly kit_slug: string;
    readonly version: string;
    /** pending | installing | installed | failed */
    readonly status: string;
    readonly failure_reason?: string;
    readonly materializations?: readonly KitMaterializationRow[];
}

/** What `/studio-desktop/kits/install` answers. */
export interface KitInstallAnswer {
    readonly installation?: KitInstallationRow;
    readonly error?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The desktop backend's own routes. */
export function desktopUrl(path: string): string {
    return new Endpoint({ path: `studio-desktop/${path}` }).getRestUrl().toString();
}

/** A Studio gear, through the desktop's `/studio-api` proxy, which adds the member's token. */
export function studioApiUrl(gearPath: string): string {
    const at = gearPath.indexOf('?');
    const pathname = at >= 0 ? gearPath.slice(0, at) : gearPath;
    const query = at >= 0 ? gearPath.slice(at) : '';
    return new Endpoint({ path: `studio-api/${pathname.replace(/^\/+/, '')}` }).getRestUrl().toString() + query;
}

/**
 * The calls behind the Kits part of the Extensions view. Reads go to the
 * Studio (the catalogue, the project's installations); an install goes to the
 * desktop backend, which runs `cfs` in the open checkout and reports the result
 * (studio/src/node/desktop-kits.ts).
 */
export class StudioKitsClient {
    constructor(protected readonly fetchFn: Fetch = (input, init) => fetch(input, init)) {}

    /** The project the folder is a checkout of, or undefined for a folder not opened from Studio. */
    async project(root: string): Promise<string | undefined> {
        const answer = await this.fetchFn(desktopUrl(`opened?root=${encodeURIComponent(root)}`));
        if (!answer.ok) {
            return undefined;
        }
        return (await answer.json() as { tenantId?: string }).tenantId;
    }

    async catalog(): Promise<KitCatalogEntry[]> {
        return this.items<KitCatalogEntry>(studioApiUrl('studio-kits/v1/catalog?shelf=official&limit=200'));
    }

    async installations(projectId: string): Promise<KitInstallationRow[]> {
        return this.items<KitInstallationRow>(
            studioApiUrl(`studio-kits/v1/projects/${encodeURIComponent(projectId)}/installations?limit=200`)
        );
    }

    async install(root: string, kitSlug: string, version: string): Promise<KitInstallAnswer> {
        const answer = await this.fetchFn(desktopUrl('kits/install'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ root, kitSlug, version }),
        });
        const body = await answer.json().catch(() => ({})) as KitInstallAnswer;
        if (!answer.ok) {
            throw new Error(body.error ?? `the install could not start (${answer.status})`);
        }
        return body;
    }

    /** Stops the project wanting the kit; files already in the checkout stay. */
    async remove(projectId: string, kitSlug: string): Promise<void> {
        const answer = await this.fetchFn(
            studioApiUrl(`studio-kits/v1/projects/${encodeURIComponent(projectId)}/installations/${encodeURIComponent(kitSlug)}`),
            { method: 'DELETE' }
        );
        if (!answer.ok) {
            throw new Error(`Studio answered ${answer.status}`);
        }
    }

    protected async items<T>(url: string): Promise<T[]> {
        const answer = await this.fetchFn(url);
        if (!answer.ok) {
            throw new Error(`Studio answered ${answer.status}`);
        }
        const body = await answer.json() as { items?: T[] };
        return Array.isArray(body.items) ? body.items : [];
    }
}

/** What one kit is, for this project and checkout: the rules the card follows. */
export type KitState =
    | { readonly kind: 'available' }
    | { readonly kind: 'busy' }
    | { readonly kind: 'installed'; readonly version: string }
    | { readonly kind: 'failed'; readonly reason: string }
    | { readonly kind: 'requested'; readonly version: string };

export function kitState(installation: KitInstallationRow | undefined, busy: boolean): KitState {
    if (busy) {
        return { kind: 'busy' };
    }
    if (!installation) {
        return { kind: 'available' };
    }
    if (installation.status === 'installed') {
        return { kind: 'installed', version: installation.version };
    }
    if (installation.status === 'failed') {
        return { kind: 'failed', reason: installation.failure_reason ?? 'the install failed' };
    }
    // pending or installing: asked for, and not on this machine yet.
    return { kind: 'requested', version: installation.version };
}

/** A commit SHA reads as its first seven characters, as Git shows it; a tag or branch as it is. */
export function shortVersion(version: string): string {
    return /^[0-9a-f]{40}$/i.test(version) ? version.slice(0, 7) : version;
}
