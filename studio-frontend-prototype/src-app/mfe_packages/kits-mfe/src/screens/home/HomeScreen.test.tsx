import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  FRONTX_SHARED_PROPERTY_THEME,
} from '@gears-frontx/react';
import { createMfeBridgeFixture } from '@frontx-test-utils/createMfeBridgeFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useScreenTranslationsMock, useApiQueryMock } = vi.hoisted(() => ({
  useScreenTranslationsMock: vi.fn(),
  useApiQueryMock: vi.fn(),
}));

vi.mock('@gears-frontx/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@gears-frontx/react')>()),
  apiRegistry: {
    getService: () => ({
      catalog: {},
      describe: ({ slug }: { slug: string }) => ({
        fetch: () =>
          Promise.resolve({
            kit: { slug },
            manifest: '.cf-studio-kit.toml',
            contents: {
              screens: [{ kind: 'tab', level: 'project', label: 'Tests', route: '/tests', slot: null }],
              types: [],
              rules: [],
              functions: [],
              services: [],
              inbox: [],
              mcp_tools: [{ name: 'kits_describe', description: 'what a kit brings' }],
              permissions: { reads: ['studio-artifact-ingest runs'], writes: [], listens: [] },
              material: [{ path: 'templates/', description: 'artifact templates' }],
              kinds: ['PRD', 'ADR'],
              docs: [],
            },
          }),
      }),
    }),
  },
  useApiQuery: useApiQueryMock,
}));

vi.mock('../../i18n', () => ({
  useHomeTranslations: useScreenTranslationsMock,
}));

import { HomeScreen } from './HomeScreen';

// Neutral fixture values — test-controlled, not tied to any template placeholder.
const TEST_THEME = 'smoke-theme';
const TEST_LANGUAGE = 'en';
const TEST_DOMAIN_ID = 'smoke-domain';
const TEST_INSTANCE_ID = 'smoke-instance';

describe('HomeScreen', () => {
  beforeEach(() => {
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: false });
    useApiQueryMock.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        total: 1,
        items: [
          {
            slug: 'sdlc',
            name: 'SDLC',
            description: 'How a project goes from spec to release',
            publisher: 'Constructor',
            visibility: 'public',
            source: 'official',
            repository_url: 'https://github.com/example/sdlc',
            default_version: 'v1.2.0',
            manifest_path: '.cf-studio-kit.toml',
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the localized title, description, and a card per catalogue kit', async () => {
    const { bridge } = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    const { container } = render(<HomeScreen bridge={bridge} />);

    // The key-echoing translation mock makes the i18n keys directly assertable.
    expect(await screen.findByText('title')).toBeTruthy();
    expect(screen.getByText('description_platform')).toBeTruthy();
    expect(screen.getByText('SDLC')).toBeTruthy();
    expect(screen.getByText('v1.2.0')).toBeTruthy();
    expect(screen.getByText('github.com/example/sdlc')).toBeTruthy();

    // An unknown host theme bridges to the kit's light scope.
    expect((container.firstChild as HTMLElement).getAttribute('data-theme')).toBe('light');
  });

  it.each(['dark', 'dracula', 'dracula-large'])(
    'bridges the %s host theme to the kit dark scope',
    (hostTheme) => {
      const { bridge } = createMfeBridgeFixture({
        domainId: TEST_DOMAIN_ID,
        instanceId: TEST_INSTANCE_ID,
        initialProperties: {
          [FRONTX_SHARED_PROPERTY_THEME]: hostTheme,
          [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
        },
      });

      const { container } = render(<HomeScreen bridge={bridge} />);

      expect((container.firstChild as HTMLElement).getAttribute('data-theme')).toBe('dark');
    }
  );

  it('renders the translation-loading skeleton before localized content is ready', () => {
    useScreenTranslationsMock.mockReturnValue({ t: (key: string) => key, loading: true });

    const { bridge } = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });

    const { container } = render(<HomeScreen bridge={bridge} />);

    // The kit Skeleton's compiled CSS-module class is stable up to its hash.
    expect(container.querySelectorAll('[class*="_skeleton_"]')).toHaveLength(2);
    expect(screen.queryByText('title')).toBeNull();
  });

  it('re-reads current properties when the host swaps the bridge instance', async () => {
    const first = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'en',
      },
    });
    const second = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: 'swapped-theme',
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: 'ar',
      },
    });
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const mountNode = document.createElement('div');
    shadowRoot.appendChild(mountNode);
    document.body.appendChild(host);
    const shadowQueries = within(mountNode);

    const { rerender } = render(<HomeScreen bridge={first.bridge} />, {
      container: mountNode,
    });

    expect(await shadowQueries.findByText('title')).toBeTruthy();
    expect(host.dir).toBe('ltr');

    rerender(<HomeScreen bridge={second.bridge} />);

    // The new bridge's current language is re-read during render — its
    // subscriptions only deliver future changes and never fire here.
    expect(host.dir).toBe('rtl');

    // Theme, language, the organization and the project in scope (the installer reads them).
    // The old bridge's subscriptions were torn down and re-registered on the
    // new instance.
    expect(first.unsubscriptions).toHaveLength(4);
    for (const { unsubscribe } of first.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
    expect(second.subscribeToProperty).toHaveBeenCalledTimes(4);

    host.remove();
  });

  it('reacts to bridge language updates and unsubscribes on unmount', async () => {
    const bridgeFixture = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });
    const host = document.createElement('div');
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const mountNode = document.createElement('div');
    shadowRoot.appendChild(mountNode);
    document.body.appendChild(host);
    const shadowQueries = within(mountNode);

    const { unmount } = render(<HomeScreen bridge={bridgeFixture.bridge} />, {
      container: mountNode,
    });

    expect(await shadowQueries.findByText('title')).toBeTruthy();
    expect(host.dir).toBe('ltr');

    act(() => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'ar');
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, 'dark');
    });

    expect(host.dir).toBe('rtl');
    expect((mountNode.firstChild as HTMLElement).getAttribute('data-theme')).toBe('dark');

    act(() => {
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_LANGUAGE, 'en');
      bridgeFixture.setProperty(FRONTX_SHARED_PROPERTY_THEME, 'light');
    });

    expect(host.dir).toBe('ltr');
    expect((mountNode.firstChild as HTMLElement).getAttribute('data-theme')).toBe('light');

    unmount();
    // Theme, language, the organization and the project in scope.

    expect(bridgeFixture.unsubscriptions).toHaveLength(4);
    for (const { unsubscribe } of bridgeFixture.unsubscriptions) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }

    host.remove();
  });

  it('says on the card what the kit brings, and opens its page with every section', async () => {
    const { bridge } = createMfeBridgeFixture({
      domainId: TEST_DOMAIN_ID,
      instanceId: TEST_INSTANCE_ID,
      initialProperties: {
        [FRONTX_SHARED_PROPERTY_THEME]: TEST_THEME,
        [FRONTX_SHARED_PROPERTY_LANGUAGE]: TEST_LANGUAGE,
      },
    });
    render(<HomeScreen bridge={bridge} />);
    // The card's one line, from the kit's contents.
    expect(await screen.findByText(/sum_screens/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'inside' }));
    // The page: one block per manifest section, an empty one says so.
    expect(await screen.findByText('sec_screens')).toBeTruthy();
    expect(screen.getByText('sec_permissions')).toBeTruthy();
    expect(screen.getByText('kits_describe')).toBeTruthy();
    expect(screen.getByText('templates/')).toBeTruthy();
    expect(screen.getByText('PRD')).toBeTruthy();
    expect(screen.getByText('.cf-studio-kit.toml')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /back/ }));
    expect(await screen.findByRole('button', { name: 'inside' })).toBeTruthy();
  });
});

describe('the level a Kits screen is opened on', () => {
  it('is said by the extension the shell mounted', async () => {
    const { scopeOf } = await import('./HomeScreen');
    expect(scopeOf('gts…~constructor_studio.kits.screens.main.v1')).toBe('platform');
    expect(scopeOf('gts…~constructor_studio.kits.screens.organization.v1')).toBe('organization');
    expect(scopeOf('gts…~constructor_studio.kits.screens.project.v1')).toBe('project');
    expect(scopeOf(undefined)).toBe('platform');
  });
});
