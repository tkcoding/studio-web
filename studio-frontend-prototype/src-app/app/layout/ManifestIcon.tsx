/**
 * A tab's or a menu item's icon, as its manifest names it (`lucide:<name>`).
 *
 * `lucide-react/dynamic` is loaded on first use, not with the shell: its name
 * map (every lucide icon, each behind its own `import()`) was a quarter of a
 * megabyte of the host's entry chunk before minification. The glyph itself
 * always arrived in a chunk of its own after the first paint, so the map
 * coming the same way changes nothing the person sees: the label is there at
 * once and the glyph joins it.
 */

import React, { Suspense } from 'react';
import { levelIconName } from './levelIcon';

export interface ManifestIconProps {
  /** What the manifest declares, e.g. `lucide:users`. */
  declared: string | undefined;
  className?: string;
}

const LucideByName = React.lazy(async () => {
  const { DynamicIcon, iconNames } = await import('lucide-react/dynamic');
  const ByName: React.FC<ManifestIconProps> = ({ declared, className }) => {
    const name = levelIconName(declared, iconNames);
    return name ? <DynamicIcon name={name} className={className} aria-hidden="true" /> : null;
  };
  return { default: ByName };
});

export const ManifestIcon: React.FC<ManifestIconProps> = ({ declared, className }) => {
  // Not a lucide name: nothing to load, nothing to draw.
  if (!declared?.startsWith('lucide:')) return null;
  return (
    <Suspense fallback={null}>
      <LucideByName declared={declared} className={className} />
    </Suspense>
  );
};

ManifestIcon.displayName = 'ManifestIcon';
