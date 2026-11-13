/**
 * Docs & API — the built-in kit `studio-api-docs` (ADR-0069), the prototype's
 * /api-docs/ page carried over: the backend's own `/cf/openapi.json`, grouped
 * by the gear that serves it (model/apiDocs.ts, unchanged), in Scalar — a
 * viewer that shows `x-tagGroups` as a level of its own.
 *
 * Scalar paints the whole document it lives in, so it gets a document of its
 * own: a sandboxed frame whose page loads the pinned viewer and is handed the
 * grouped description. Opened from the product menu, across the screen.
 */

import React, { useEffect, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import { FRONTX_SHARED_PROPERTY_THEME } from '@gears-frontx/react';
import { Skeleton } from '@gears-frontx/ui-kit';
import { groupByComponent, type OpenApiDoc } from '../../model/apiDocs';
import { useDocsTranslations } from '../../i18n';
import styles from './DocsScreen.module.css';

const SPEC_URL = '/cf/openapi.json';
/** Pinned: a viewer that changes under the page is a page nobody tested. */
export const SCALAR_URL = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.3';
const DARK_HOST_THEMES = ['dark', 'dracula', 'dracula-large'];

/** The frame's page: the viewer, and the grouped description inline. `</` is
 *  escaped so no string in the description can end the script early. */
export function viewerPage(doc: OpenApiDoc, dark: boolean): string {
  const config = {
    content: groupByComponent(doc),
    // Collapsed: forty sections open at once is the flat list again.
    defaultOpenAllTags: false,
    hideClientButton: true,
    // Scalar's own hosted-service upsells are not part of our API.
    showDeveloperTools: 'never',
    agent: { disabled: true },
    mcp: { disabled: true },
    darkMode: dark,
    metaData: { title: 'Studio API' },
  };
  const json = JSON.stringify(config).replace(/<\//g, '<\\/');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Studio API</title>',
    '<style>body{margin:0}</style></head><body><div id="app"></div>',
    `<script src="${SCALAR_URL}"></script>`,
    `<script>window.Scalar.createApiReference('#app', ${json});</script>`,
    '</body></html>',
  ].join('');
}

export const DocsScreen: React.FC<{ bridge: ChildMfeBridge }> = ({ bridge }) => {
  const { t, loading } = useDocsTranslations();
  const theme = bridge.getProperty(FRONTX_SHARED_PROPERTY_THEME)?.value;
  const dark = typeof theme === 'string' && DARK_HOST_THEMES.includes(theme);
  const [doc, setDoc] = useState<OpenApiDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(SPEC_URL, { headers: { Accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${SPEC_URL} answered ${res.status}`);
        return (await res.json()) as OpenApiDoc;
      })
      .then(
        (d) => alive && setDoc(d),
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e))
      );
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <Skeleton className={styles.skeleton} />;
  return (
    <div className={styles.screen} data-api-docs>
      {error ? (
        <p role="alert" className={styles.error}>
          {t('load_failed', { error })}
        </p>
      ) : !doc ? (
        <p className={styles.muted}>{t('loading')}</p>
      ) : (
        <iframe
          className={styles.frame}
          title={t('title')}
          // Scripts for the viewer; popups for its links out. No same-origin:
          // the page needs nothing of the portal's.
          sandbox="allow-scripts allow-popups"
          srcDoc={viewerPage(doc, dark)}
        />
      )}
    </div>
  );
};

DocsScreen.displayName = 'DocsScreen';
