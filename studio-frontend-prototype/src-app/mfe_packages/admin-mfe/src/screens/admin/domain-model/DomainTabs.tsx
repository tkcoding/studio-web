import { useState } from 'react';
import { Button, Input, NativeSelect, NativeSelectOption } from '@gears-frontx/ui-kit';
import { ancestorsOf, type DomainModel } from '../../../model/domain-runtime';
import { linksOf } from '../../../model/domain-origin';
import { useAdmin } from '../common';
import styles from '../Admin.module.css';
import own from './DomainModel.module.css';

export interface TabInput { name: string; label: string; target: string }

/** Model tabs are `shows` relations; the shell draws them (LevelTabs). Which a place hides is its settings document's `hidden_tabs`. */
export function DomainTabs({ model, id, busy, onAdd, onRemove }: {
  model: DomainModel;
  id: string;
  busy: boolean;
  onAdd: (input: TabInput) => Promise<boolean>;
  onRemove: (name: string) => Promise<boolean>;
}) {
  const { t } = useAdmin();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState('');
  const chain = ancestorsOf(model, id);
  const tabs = linksOf(model, id).out.filter((link) => link.kind === 'shows');
  const names = new Set(chain.flatMap((type) => model.byId.get(type)?.properties?.map((p) => p.name) ?? []));
  const validName = /^[a-z0-9_-]{1,64}$/.test(name) && !names.has(name);
  const level = ['organization', 'workspace', 'project'].includes(id);
  if (!level && tabs.length === 0) return null;
  return <section className={own.relations} data-dm-tabs>
    <div className={styles.inline}>
      <h4 className={own.h4}>{t('dm_tabs')}</h4>
      {model.canEdit && level && !adding && <Button size="sm" variant="outline" disabled={busy} onClick={() => setAdding(true)}>{t('dm_add_tab')}</Button>}
    </div>
    <p className={styles.muted}>{t('dm_tabs_hint')}</p>
    {tabs.length === 0 ? <p className={styles.muted}>{t('dm_no_tabs')}</p> : <ul className={own.links}>
      {tabs.map((tab) => {
        const property = model.byId.get(id)?.properties?.find((p) => p.name === tab.name);
        return <li key={`${tab.name}:${tab.other}`}>
          <span>{tab.label}</span> · <code>{tab.name}</code> → {model.byId.get(tab.other)?.name ?? tab.other}
          {tab.inherited && <span className={styles.sub}> · {t('dm_inherited')}</span>}
          {model.canEdit && !tab.inherited && !property?.held_by && <Button size="sm" variant="ghost" disabled={busy} aria-label={t('dm_remove_tab_named', { name: tab.label })} onClick={() => void onRemove(tab.name)}>{t('dm_remove_tab')}</Button>}
        </li>;
      })}
    </ul>}
    {adding && model.canEdit && <form className={own.dialogBody} onSubmit={async (event) => {
      event.preventDefault();
      if (!validName || !target || busy) return;
      if (await onAdd({ name, label: label.trim() || name, target })) {
        setAdding(false); setName(''); setLabel(''); setTarget('');
      }
    }}>
      <label className={styles.field}>{t('dm_tab_name')}<Input value={name} disabled={busy} onChange={(event) => setName(event.target.value.trim())} /></label>
      <p className={styles.sub}>{t('dm_tab_name_hint')}</p>
      <label className={styles.field}>{t('dm_tab_label')}<Input value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className={styles.field}>{t('dm_tab_target')}
        <NativeSelect value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
          <NativeSelectOption value="">{t('dm_tab_choose_type')}</NativeSelectOption>
          {model.entities.filter((e) => !e.abstract).map((e) => <NativeSelectOption key={e.id} value={e.id}>{e.name ?? e.id}</NativeSelectOption>)}
        </NativeSelect>
      </label>
      <div className={styles.inline}>
        <Button type="submit" size="sm" disabled={busy || !validName || !target}>{t('dm_add_tab')}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setAdding(false)}>{t('cancel')}</Button>
      </div>
    </form>}
  </section>;
}
