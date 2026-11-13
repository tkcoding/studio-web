import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildMfeBridge } from '@gears-frontx/react';

const { translations, openScreen } = vi.hoisted(() => ({ translations: vi.fn(), openScreen: vi.fn() }));

vi.mock('../../i18n', () => ({ useComponentsTranslations: translations }));
vi.mock('@constructor-studio/mfe-shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@constructor-studio/mfe-shared')>()),
  openScreen,
}));

import { api } from '../../api/client';
import type { PlanRow } from '../../api/types';
import { ScopeContext, type Scope } from '../common';
import { ProjectComponentsInventory } from './ProjectComponentsInventory';
import { declareRefusal, detectedProjects, evidenceLines, scaffoldTargetLine } from './registryLines';

const plan = [
  {
    capability: 'billing',
    gap: true,
    unbuilt: false,
    nonfunctional: false,
    candidates: [],
  },
  {
    capability: 'auth',
    gap: false,
    unbuilt: false,
    nonfunctional: false,
    candidates: [
      { name: 'cf-gears-auth', built: 'built', tier: 'platform', kind: 'gear' },
      { name: 'cf-gears-other', built: 'built', tier: 'organization', kind: 'gear' },
    ],
  },
] as unknown as PlanRow[];

function scope(): Scope {
  return {
    projectId: 'p1',
    workspaceId: 'w1',
    orgId: 'o1',
    language: 'en',
    bridge: {} as ChildMfeBridge,
    container: createRef<HTMLDivElement>(),
  };
}

function draw(onOpenProduct?: () => void) {
  return render(
    <ScopeContext.Provider value={scope()}>
      <ProjectComponentsInventory onOpenProduct={onOpenProduct} />
    </ScopeContext.Provider>
  );
}

describe('ProjectComponentsInventory', () => {
  beforeEach(() => {
    translations.mockReturnValue({
      t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
      loading: false,
    });
    vi.spyOn(api, 'projectPlan').mockResolvedValue({ items: plan, total: plan.length });
    vi.spyOn(api, 'projectProduct').mockResolvedValue({ gears: ['cf-gears-other'] });
    vi.spyOn(api, 'projectComponents').mockResolvedValue({ items: [], total: 0, repos: 0 });
    vi.spyOn(api, 'declaredCapabilities').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'capabilities').mockResolvedValue({ items: [] });
    vi.spyOn(api, 'conformance').mockRejectedValue(new Error('no code'));
    vi.spyOn(api, 'componentRegistry').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'deployments').mockResolvedValue({ items: [], total: 0 });
    vi.spyOn(api, 'projectTargets').mockRejectedValue(new Error('none'));
    vi.spyOn(api, 'gearboxCatalogue').mockRejectedValue(new Error('no engine'));
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    openScreen.mockReset();
  });

  it('lists what the project is made of, says what could not be read, and offers a gear to create', async () => {
    draw();
    await waitFor(() => expect(document.querySelector('[data-inventory-row]')).not.toBeNull());
    expect(document.querySelector('[data-role="create"]')?.textContent).toContain('billing');
    expect(document.querySelector('[data-role="organization"]')?.textContent).toContain('cf-gears-other');
    expect(document.querySelector('[data-inventory-partial]')?.textContent).toContain('partial_code');
    expect(document.querySelector('[data-create-gear]')).not.toBeNull();
  });

  it('filters by whose, and opens the organization catalogue and the product', async () => {
    const onOpenProduct = vi.fn();
    vi.spyOn(api, 'conformance').mockResolvedValue({ components_in_code: ['cf-gears-auth'] } as never);
    draw(onOpenProduct);
    await waitFor(() => expect(document.querySelector('[data-role-chip="platform"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-role-chip="platform"]')!);
    expect(document.querySelectorAll('[data-inventory-row]')).toHaveLength(1);
    fireEvent.click(screen.getByText('open_catalogue'));
    expect(openScreen).toHaveBeenCalledWith(expect.anything(), '/components');
    fireEvent.click(screen.getByText('put_into_product'));
    expect(onOpenProduct).toHaveBeenCalledTimes(1);
  });

  it('shows the plan read failure with Retry', async () => {
    vi.spyOn(api, 'projectPlan').mockRejectedValue(new Error('down'));
    draw();
    await waitFor(() => expect(screen.getByText('down')).toBeTruthy());
    expect(screen.getByText('retry')).toBeTruthy();
  });
});

describe('the registry lines', () => {
  it('orders evidence heaviest first and names the detected projects once', () => {
    expect(
      evidenceLines({
        evidence: [
          { detail: 'a', weight: 1 },
          { detail: 'b', weight: 3 },
        ],
      } as never)
    ).toEqual(['b (+3)', 'a (+1)']);
    expect(
      detectedProjects({
        occurrences: [
          { declared_in: 'detected', project_id: 'p1' },
          { declared_in: 'detected', project_id: 'p1' },
          { declared_in: 'gear.gdl', project_id: 'p2' },
        ],
      } as never)
    ).toEqual(['p1']);
  });

  it('words a refusal and where a scaffold goes', () => {
    expect(declareRefusal(403, 'x')).toMatch(/administrator/);
    expect(declareRefusal(500, 'x')).toBe('x');
    expect(scaffoldTargetLine('project', 'acme/gears')).toBe("Into this project's gear repository acme/gears.");
    expect(scaffoldTargetLine(null, null)).toMatch(/Nowhere to write/);
  });
});
