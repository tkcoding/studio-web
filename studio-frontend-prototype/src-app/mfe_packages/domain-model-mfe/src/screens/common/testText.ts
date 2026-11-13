/**
 * For tests only: every translation hook of the kit answering with the key
 * (and its params as JSON), so a test reads which sentence a screen chose.
 *
 *   vi.mock('../../i18n', async () => (await import('../common/testText')).i18nMock());
 */

type Params = Record<string, unknown>;

const say = (key: string, params?: Params) => (params ? `${key} ${JSON.stringify(params)}` : key);

export const fakeText = Object.assign(say, {
  count: (key: string, count: number, params?: Params) => say(key, { ...params, count }),
});

export const fakeTranslations = () => ({ t: fakeText, loading: false });

export function i18nMock() {
  return {
    useDomainTranslations: fakeTranslations,
    useCommonTranslations: fakeTranslations,
    useEntitiesTranslations: fakeTranslations,
    useRequirementsTranslations: fakeTranslations,
    useSourcesTranslations: fakeTranslations,
    useDiscoveryTranslations: fakeTranslations,
    useGlossaryTranslations: fakeTranslations,
    usePrioritiesTranslations: fakeTranslations,
  };
}
