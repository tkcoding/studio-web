import { StudioKitsClient, kitState, shortVersion } from './studio-kits-client';

jest.mock('@theia/core/lib/browser/endpoint', () => ({
    Endpoint: class {
        constructor(protected readonly options: { path: string }) {}
        getRestUrl(): { toString(): string } {
            return { toString: () => `http://ide/${this.options.path}` };
        }
    },
}));

function answer(status: number, body: unknown): Response {
    return { ok: status < 400, status, json: async () => body } as Response;
}

describe('studio kits client', () => {
    it('reads the project a folder was opened for, and none for a folder opened by hand', async () => {
        const urls: string[] = [];
        const client = new StudioKitsClient(async url => {
            urls.push(url);
            return url.includes('elsewhere') ? answer(404, { error: 'this folder was not opened from Studio' }) : answer(200, { tenantId: 'p-1' });
        });

        expect(await client.project('C:\\work\\app')).toBe('p-1');
        expect(await client.project('C:\\elsewhere')).toBeUndefined();
        expect(urls[0]).toBe('http://ide/studio-desktop/opened?root=C%3A%5Cwork%5Capp');
    });

    it('reads the catalogue and installations through the studio-api proxy, keeping the query', async () => {
        const urls: string[] = [];
        const client = new StudioKitsClient(async url => {
            urls.push(url);
            return answer(200, { items: [{ slug: 'sdlc' }], total: 1 });
        });

        expect(await client.catalog()).toEqual([{ slug: 'sdlc' }]);
        await client.installations('p 1');

        expect(urls).toEqual([
            'http://ide/studio-api/studio-kits/v1/catalog?shelf=official&limit=200',
            'http://ide/studio-api/studio-kits/v1/projects/p%201/installations?limit=200',
        ]);
    });

    it('says why an install could not start', async () => {
        const client = new StudioKitsClient(async () => answer(404, { error: 'this folder was not opened from Studio' }));

        await expect(client.install('C:\\x', 'sdlc', 'main')).rejects.toThrow('this folder was not opened from Studio');
    });
});

describe('kit state', () => {
    it('follows the installation row, and a running install wins', () => {
        expect(kitState(undefined, false)).toEqual({ kind: 'available' });
        expect(kitState({ kit_slug: 'sdlc', version: 'v1', status: 'installed' }, false)).toEqual({ kind: 'installed', version: 'v1' });
        expect(kitState({ kit_slug: 'sdlc', version: 'v1', status: 'pending' }, false)).toEqual({ kind: 'requested', version: 'v1' });
        expect(kitState({ kit_slug: 'sdlc', version: 'v1', status: 'failed', failure_reason: 'no cfs' }, false))
            .toEqual({ kind: 'failed', reason: 'no cfs' });
        expect(kitState({ kit_slug: 'sdlc', version: 'v1', status: 'installed' }, true)).toEqual({ kind: 'busy' });
    });

    it('shows a commit as Git does and a tag as it is', () => {
        expect(shortVersion('5c5b85c870cb4b62ed0506ae1a8ca196156d1c74')).toBe('5c5b85c');
        expect(shortVersion('v1.2.3')).toBe('v1.2.3');
    });
});
