/** LevelTabs Component  */

// @cpt-dod:cpt-studiofrontend-dod-shell-levels-shell-draws:p1
// @cpt-dod:cpt-studiofrontend-dod-shell-levels-one-mount:p1
import React, { useCallback, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  useAppSelector,
  useDomainExtensions,
  eventBus,
  FRONTX_SCREEN_DOMAIN,
} from '@gears-frontx/react';
import { useMountedExtensions } from '@/app/mfe/domainOccupancy';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from '@gears-frontx/ui-kit/navigation-menu';
import { Skeleton } from '@gears-frontx/ui-kit/skeleton';
import { RotateCcw, Star } from 'lucide-react';
import {
  MFE_BOOTSTRAP_SLICE_KEY,
  type MfeBootstrapState,
} from '@/app/slices/mfeBootstrapSlice';
import { APP_CONTEXT_SLICE_KEY, type AppContextState } from '@/app/slices/appContextSlice';
import {
  offeredTo,
  parentSectionOf,
  resolveLevelMenu,
  sectionOf,
  type StudioScreenExtension,
} from '@/app/mfe/screenLevels';
import { useShellText } from '@/app/i18n/shellTranslations';
import { usePreference } from '@/app/preferences/uiPreferences';
import { orderLevelTabs, tabOrderKey } from '@/app/preferences/levelTabOrder';
import { isDefaultOrder, moveTo, serializeOrder } from '@/app/preferences/tab-order';
import { pinFor, usePins } from '@/app/pins/usePins';
import { isPinned } from '@/app/pins/pins';
import { cn } from '@/app/lib/utils';
import { SHELL_SLOTS } from '@/app/mfe/slots';
import { KitSlot } from './KitSlot';
import { ManifestIcon } from './ManifestIcon';
import { useScreenLevel } from './useScreenLevel';
import { screenShows, typesNeeded, useInstalledKits, useInstalledTypes } from './useInstalledKits';
import { modelNameOf, screenIdOf, visibleTabs, withModelTabs } from './modelTabs';
import { useHiddenTabs, useLevelModelTabs, useLevelTenant } from './useModelTabs';
import { LevelTabsEditor } from './LevelTabsEditor';
import { useDecidesRequests } from './OrganizationRequests';
import styles from './LevelTabs.module.css';

function isActiveItem(
  item: StudioScreenExtension,
  mounted: StudioScreenExtension | undefined,
  section: string | null
): boolean {
  const itemSection = sectionOf(item);
  // A hidden screen (the editor) names the section it belongs to.
  const parent = mounted && parentSectionOf(mounted);
  if (parent !== undefined) return itemSection === parent;
  if (itemSection !== undefined && mounted && item.entry === mounted.entry) {
    return itemSection === section;
  }
  return item.id === mounted?.id;
}

const selectContext = (state: Record<string, unknown>) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined;

export const LevelTabs: React.FC = () => {
  const t = useShellText();
  const level = useScreenLevel();
  const registered = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as StudioScreenExtension[];
  const installed = useInstalledKits();
  // A platform administrator's screens (Admin › System) for them alone.
  const platformAdmin = useDecidesRequests();
  // The manifests' tabs (a tab whose kit or needed type is not installed here
  // left out), then the ones the Studio domain model adds (ADR-0066), then
  // without what the level's settings hide.
  const leveled = resolveLevelMenu(registered, level);
  const types = useInstalledTypes(leveled.some((ext) => typesNeeded(ext).length > 0));
  const modelTabs = useLevelModelTabs(level);
  const all = withModelTabs(
    leveled.filter((ext) => screenShows(ext, installed, types) && offeredTo(ext, platformAdmin)),
    registered,
    level,
    modelTabs
  );
  const tenant = useLevelTenant(level);
  const { hidden, save: saveHidden } = useHiddenTabs(level, tenant);
  const [preview, setPreview] = useState<string[] | null>(null);
  const items = visibleTabs(all, preview ?? hidden);
  const mounted = useMountedExtensions(FRONTX_SCREEN_DOMAIN)[0] as StudioScreenExtension | undefined;
  const section = useAppSelector((state) => selectContext(state)?.section ?? null);
  const org = useAppSelector((state) => selectContext(state)?.org ?? null);
  const workspace = useAppSelector((state) => selectContext(state)?.workspace ?? null);
  const project = useAppSelector((state) => selectContext(state)?.project ?? null);
  const bootstrapStatus = useAppSelector(
    (state) =>
      (state[MFE_BOOTSTRAP_SLICE_KEY] as MfeBootstrapState | undefined)?.status ?? 'pending'
  );

  // The order the person keeps (`/me/ui-preferences`), read against the
  // level's own list on every render: a tab added since keeps its place.
  const [stored, setStored] = usePreference(tabOrderKey(level));
  const ordered = orderLevelTabs(items, stored);
  const order = ordered.map((tab) => tab.id);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where a drop would land: an index into the order without the dragged tab. */
  const [dropAt, setDropAt] = useState<number | null>(null);

  const { pins, toggle } = usePins();
  const activeItem = items.find((ext) => isActiveItem(ext, mounted, section));
  const pin = activeItem ? pinFor(activeItem, level, { org, workspace, project }) : null;
  const pinned = pin ? isPinned(pins, pin) : false;

  const choose = useCallback((chosen: StudioScreenExtension) => {
    // A tab the model adds is its generic screen, under the tab's section.
    const screenId = screenIdOf(chosen);
    const section = sectionOf(chosen);
    eventBus.emit(
      'app/context/screen/requested',
      screenId !== chosen.id && section ? { extensionId: screenId, section } : { extensionId: chosen.id }
    );
  }, []);

  const save = (next: string[]) =>
    setStored(isDefaultOrder(next, orderLevelTabs(items, '')) ? '' : serializeOrder(next));

  const slotFor = (e: DragEvent<HTMLElement>, index: number) => {
    const box = e.currentTarget.getBoundingClientRect();
    const after = e.clientX > box.left + box.width / 2;
    const raw = index + (after ? 1 : 0);
    // The dragged tab leaves its own slot, so everything behind it moves up one.
    const from = dragging ? order.indexOf(dragging) : -1;
    return from >= 0 && raw > from ? raw - 1 : raw;
  };

  const endDrag = () => {
    setDragging(null);
    setDropAt(null);
  };

  const onKey = (e: KeyboardEvent<HTMLElement>, id: string, index: number) => {
    if (!e.altKey || !e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const to = e.key === 'ArrowLeft' ? index - 1 : index + 1;
    if (to < 0 || to >= order.length) return;
    save(moveTo(order, id, to));
    // Keep the focus on the tab that moved; it is re-rendered in its new slot.
    const row = e.currentTarget.closest('nav');
    requestAnimationFrame(() => row?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus());
  };

  if (items.length === 0) {
    return bootstrapStatus === 'pending' ? (
      <div className={styles.row} aria-hidden="true">
        <Skeleton className={styles.pending} />
      </div>
    ) : null;
  }

  const from = dragging ? order.indexOf(dragging) : -1;
  // The slot index the indicator sits in front of, in the full order. Nothing
  // is drawn where the drop would change nothing.
  const marker = dropAt === null || dropAt === from ? null : from >= 0 && dropAt >= from ? dropAt + 1 : dropAt;
  const reorderHint = t('level_tabs_reorder_hint');

  return (
    <NavigationMenu aria-label={t('level_tabs')} className={styles.row}>
      <NavigationMenuList className={styles.list}>
        {ordered.map(({ id, extension: ext }, index) => {
          return (
            <NavigationMenuItem key={ext.id}>
              <NavigationMenuLink
                size="compact"
                active={isActiveItem(ext, mounted, section)}
                render={
                  <button
                    type="button"
                    data-tab={id}
                    title={reorderHint}
                    draggable
                    onClick={() => choose(ext)}
                    onKeyDown={(e) => onKey(e, id, index)}
                    onDragStart={(e) => {
                      setDragging(id);
                      e.dataTransfer.effectAllowed = 'move';
                      // Firefox starts no drag without data.
                      e.dataTransfer.setData('text/plain', ext.presentation?.label ?? id);
                    }}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      const at = slotFor(e, index);
                      if (at !== dropAt) setDropAt(at);
                    }}
                    onDrop={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      const at = slotFor(e, index);
                      if (at !== order.indexOf(dragging)) save(moveTo(order, dragging, at));
                      endDrag();
                    }}
                    onDragEnd={endDrag}
                  />
                }
                className={cn(
                  styles.tab,
                  dragging === id && styles.dragging,
                  dragging && marker === index && dragging !== id && styles.dropBefore,
                  dragging && marker === order.length && index === order.length - 1 && styles.dropAfter
                )}
              >
                <ManifestIcon declared={ext.presentation.icon} className={styles.glyph} />
                {ext.presentation?.label}
                {ext.presentation?.experimental && (
                  <span className={styles.exp} title={t('level_tab_experimental')}>
                    EXP
                  </span>
                )}
              </NavigationMenuLink>
            </NavigationMenuItem>
          );
        })}
        {stored && !isDefaultOrder(order, orderLevelTabs(items, '')) && (
          <NavigationMenuItem>
            <button
              type="button"
              className={styles.aside}
              title={t('level_tabs_default_order_hint')}
              onClick={() => save(orderLevelTabs(items, '').map((tab) => tab.id))}
            >
              <RotateCcw aria-hidden="true" className={styles.asideGlyph} />
              {t('level_tabs_default_order')}
            </button>
          </NavigationMenuItem>
        )}
        {/* Pinning belongs on the section, not in a picker: only here is it
            known which section of which project is open (the prototype's
            band did the same). The pins are listed in the header. */}
        {pin && (
          <NavigationMenuItem>
            <button
              type="button"
              className={cn(styles.aside, pinned && styles.asideOn)}
              aria-pressed={pinned}
              title={pinned ? t('pin_remove_hint') : t('pin_add_hint')}
              data-pin-toggle
              onClick={() => toggle(pin)}
            >
              <Star aria-hidden="true" className={styles.asideGlyph} fill={pinned ? 'currentColor' : 'none'} />
              {pinned ? t('pin_pinned') : t('pin_pin')}
            </button>
          </NavigationMenuItem>
        )}
        {/* Which tabs show here, for everyone in this place (`hidden_tabs`). */}
        {saveHidden && (
          <NavigationMenuItem>
            <LevelTabsEditor
              tabs={all.map((ext) => ({ id: modelNameOf(ext), label: ext.presentation?.label ?? modelNameOf(ext) }))}
              hidden={hidden}
              onSave={saveHidden}
              onPreview={setPreview}
            />
          </NavigationMenuItem>
        )}
        {/* Kits' actions for this level or this screen (slot screen.toolbar.actions). */}
        <NavigationMenuItem>
          <KitSlot slot={SHELL_SLOTS.screenToolbarActions} />
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
};

LevelTabs.displayName = 'LevelTabs';
