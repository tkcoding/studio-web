/**
 * Everything a mounted root of this MFE has to do with the host's chrome:
 * theme, language, text direction, and this realm's own i18n registry.
 */

import { useEffect, useRef } from 'react';
import {
  FRONTX_SHARED_PROPERTY_THEME,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  SUPPORTED_LANGUAGES,
  useFrontX,
  useSharedProperty,
  type Language,
} from '@gears-frontx/react';

const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

const DARK_HOST_THEMES = ['dark', 'dracula', 'dracula-large'];

/** The kit palette a host theme id maps to; the shell's themes must declare the same `appearance`. */
export function toKitTheme(hostTheme: string): 'dark' | 'light' {
  return DARK_HOST_THEMES.includes(hostTheme) ? 'dark' : 'light';
}

/** A non-string value means the shell has not published this one yet. */
function published(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export interface HostChrome {
  readonly containerRef: React.RefObject<HTMLDivElement | null>;
  readonly dataTheme: 'dark' | 'light';
  readonly language: string;
}

export function useHostChrome(): HostChrome {
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = published(useSharedProperty(FRONTX_SHARED_PROPERTY_THEME), 'default');
  const language = published(useSharedProperty(FRONTX_SHARED_PROPERTY_LANGUAGE), 'en');

  const app = useFrontX();

  useEffect(() => {
    const supported = SUPPORTED_LANGUAGES.some((entry) => entry.code === language);
    if (supported) void app.i18nRegistry?.setLanguage(language as Language);
  }, [app, language]);

  useEffect(() => {
    const rootNode = containerRef.current?.getRootNode();
    if (rootNode && 'host' in rootNode) {
      (rootNode.host as HTMLElement).dir = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    }
  }, [language]);

  return { containerRef, dataTheme: toKitTheme(theme), language };
}
