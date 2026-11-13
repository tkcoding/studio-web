import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocType } from '../../api/types';

const { service, scope, calls } = vi.hoisted(() => ({
  service: {} as Record<string, unknown>,
  scope: { workspace: { id: 'w1', name: 'Platform' } as { id: string; name: string } | null },
  calls: [] as { workspace: string; body: unknown }[],
}));

vi.mock('../../i18n', () => {
  const t = (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key);
  return { useDocumentTypesTranslations: () => ({ t, loading: false }) };
});
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  useWorkspace: () => ({ workspace: scope.workspace, loading: false }),
  useHostChrome: () => ({ containerRef: { current: null }, dataTheme: 'light', language: 'en' }),
}));
vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: { getService: () => service },
}));

import { DocumentTypesScreen } from './DocumentTypesScreen';

const type = (key: string, patch: Partial<DocType> = {}): DocType => ({
  key,
  name: key.toUpperCase(),
  description: '',
  gts_type_id: `gts.${key}`,
  owner: 'builtin',
  body: '# <title>\n',
  sections: [{ key: 'context', title: 'Context', required: true }],
  rules: { warn_unknown_sections: false, front_matter: [], forbid_placeholders: true, min_title_words: 1 },
  ...patch,
});

function serve({
  types = [type('adr'), type('prd', { owner: 'workspace', rules: { ...type('x').rules, front_matter: ['status'] } })],
  caps = { doc_types: ['prd'] } as unknown,
  reads = { count: 0 },
} = {}) {
  for (const key of Object.keys(service)) delete service[key];
  Object.assign(service, {
    types: () => ({ fetch: () => (reads.count++, Promise.resolve({ items: types })) }),
    capabilities: { fetch: () => (caps instanceof Error ? Promise.reject(caps) : Promise.resolve(caps)) },
    upsertType: (workspace: string) => ({
      fetch: (body: unknown) => (calls.push({ workspace, body }), Promise.resolve(body)),
    }),
  });
  return reads;
}

describe('DocumentTypesScreen', () => {
  beforeEach(() => {
    calls.length = 0;
    scope.workspace = { id: 'w1', name: 'Platform' };
    serve();
  });

  it('asks for a workspace when none is in scope', () => {
    scope.workspace = null;
    render(<DocumentTypesScreen />);
    expect(screen.getByText('no_workspace')).toBeTruthy();
  });

  it("lists the workspace's types with their owner, counts and whether the analyser takes them", async () => {
    render(<DocumentTypesScreen />);
    await waitFor(() => expect(document.querySelector('[data-doc-type="prd"]')).toBeTruthy());
    expect(screen.getByText('types_count_many {"count":2}')).toBeTruthy();
    const adr = document.querySelector('[data-doc-type="adr"]')!;
    expect(adr.textContent).toContain('owner_builtin');
    expect(adr.textContent).toContain('—');
    await waitFor(() => expect(adr.querySelector('[data-doc-type-analyser]')!.textContent).toBe('template_only'));
    const prd = document.querySelector('[data-doc-type="prd"]')!;
    expect(prd.textContent).toContain('owner_workspace');
    expect(prd.querySelector('[data-doc-type-analyser]')!.textContent).toBe('analysable');
    expect(document.querySelector('[data-doc-types-empty]')).toBeTruthy();
  });

  it('says "?" when the analyser cannot say what it accepts', async () => {
    serve({ caps: new Error('upstream down') });
    render(<DocumentTypesScreen />);
    await waitFor(() => expect(document.querySelector('[data-doc-type="adr"]')).toBeTruthy());
    expect(document.querySelector('[data-doc-type="adr"] [data-doc-type-analyser]')!.textContent).toBe('?');
  });

  it('overrides a picked type as the workspace’s own and reads the list again', async () => {
    const reads = serve();
    render(<DocumentTypesScreen />);
    await waitFor(() => expect(document.querySelector('[data-doc-type="adr"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-doc-type="adr"]')!);
    expect((document.querySelector('[data-doc-type-key]') as HTMLInputElement).value).toBe('adr');
    fireEvent.change(document.querySelector('[data-doc-type-front-matter]')!, { target: { value: 'status, owner' } });
    fireEvent.click(document.querySelector('[data-doc-type-add-section]')!);
    fireEvent.click(document.querySelector('[data-doc-type-warn]')!);
    expect(document.querySelector('[data-doc-type-checks]')!.textContent).toContain('check_front_matter {"keys":"status, owner"}');
    fireEvent.click(document.querySelector('[data-doc-type-save]')!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      workspace: 'w1',
      body: {
        key: 'adr',
        name: 'ADR',
        description: '',
        body: '# <title>\n',
        // The untitled section added is not saved.
        sections: [{ key: 'context', title: 'Context', required: true, min_words: null, aliases: null }],
        rules: { warn_unknown_sections: true, front_matter: ['status', 'owner'], forbid_placeholders: true, min_title_words: 1 },
      },
    });
    await waitFor(() => expect(reads.count).toBe(2));
  });

  it('needs a key and a name before a new type is saved', async () => {
    render(<DocumentTypesScreen />);
    await waitFor(() => expect(document.querySelector('[data-doc-type="adr"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-doc-type-new]')!);
    expect((document.querySelector('[data-doc-type-body]') as HTMLTextAreaElement).value).toBe('# <title>\n\n## Section\n');
    fireEvent.click(document.querySelector('[data-doc-type-save]')!);
    expect(screen.getByRole('alert').textContent).toBe('key_and_name');
    expect(calls).toHaveLength(0);
  });

  it('says what went wrong when the types cannot be read', async () => {
    Object.assign(service, { types: () => ({ fetch: () => Promise.reject(new Error('boom')) }) });
    render(<DocumentTypesScreen />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
  });
});
