/**
 * Organization › Settings: the settings of the organization the path bar has
 * picked. The prototype had no tab of this name; an organization's own
 * settings lived in Admin › Organizations, on the card of the organization
 * picked there (`org-admin.tsx`): its name and rename, id, logo, managed or
 * self-managed (a dual-consent conversion), its workspaces, and the danger
 * zone. The same routes, refusals and rules are here, with the Admin sections
 * that hold the rest (people, access, secrets, connections, every
 * organization) one click away, as the prototype's "Admin settings" was.
 *
 * Who may change what is the gears' to say: every write is offered, and a
 * refusal is shown in the gear's own words where it was asked.
 */

import React, { useEffect, useRef, useState } from 'react';
import { apiRegistry, useApiQuery, useMfeBridge } from '@gears-frontx/react';
import { Badge, Button, Card, CardContent, Skeleton } from '@gears-frontx/ui-kit';
import {
  AccountsApiService,
  openScreen,
  useOrganization,
  type OrganizationRef,
} from '@constructor-studio/mfe-shared';
import { OrganizationSettingsApiService } from '../../api/OrganizationSettingsApiService';
import { ConfirmDialog, NameDialog, errText } from '../../components/dialogs';
import { useSettingsTranslations } from '../../i18n';
import { ADMIN_LINKS, LOGO_TYPES, base64Of, logoProblem, logoSrc, modeAction } from './model';
import styles from './SettingsScreen.module.css';

type Text = ReturnType<typeof useSettingsTranslations>['t'];

export const SettingsScreen: React.FC = () => {
  const { t, loading } = useSettingsTranslations();
  const { org, loading: resolving } = useOrganization();

  if (loading) {
    return (
      <div className={styles.screen}>
        <Skeleton className={styles.titleSkeleton} />
        <Skeleton className={styles.blockSkeleton} />
      </div>
    );
  }
  if (!org) {
    return (
      <div className={styles.screen} data-state="no-organization">
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.muted}>{resolving ? t('resolving_org') : t('no_org')}</p>
      </div>
    );
  }
  return <OrganizationSettings key={org.id} org={org} t={t} />;
};

SettingsScreen.displayName = 'SettingsScreen';

const OrganizationSettings: React.FC<{ org: OrganizationRef; t: Text }> = ({ org, t }) => {
  const bridge = useMfeBridge();
  const accounts = apiRegistry.getService(AccountsApiService);
  const settings = apiRegistry.getService(OrganizationSettingsApiService);
  const container = useRef<HTMLDivElement>(null);
  const tenant = useApiQuery(accounts.getTenant({ tenantId: org.id }), { staleTime: 0 });
  const me = useApiQuery(accounts.getMe);
  const workspaces = useApiQuery(accounts.getWorkspaces({ organizationId: org.id }));
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [askingMode, setAskingMode] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = tenant.data?.name ?? org.name;
  const selfManaged = !!tenant.data?.self_managed;
  // Unknown until `/me` answers: neither the danger zone nor the mode's
  // offer is shown for an organization that may be the caller's home.
  const meKnown = !!me.data || me.isError;
  const isHome = me.data?.subject_tenant_id === org.id;
  const mode = modeAction(selfManaged, isHome);
  const labels = { cancel: t('cancel'), close: t('close') };

  const request = async () => {
    if (mode.kind !== 'request') return;
    setError(null);
    try {
      await settings
        .requestConversion(org.id)
        .fetch({ target_mode: mode.target, comment: 'Requested from the Studio portal' });
      setRequested(true);
      void tenant.refetch();
    } catch (e) {
      setError(errText(e));
    }
  };

  if (deleted) {
    return (
      <div className={styles.screen} data-org-deleted>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.muted}>{t('deleted', { name })}</p>
      </div>
    );
  }

  return (
    <div className={styles.screen} ref={container} data-org-settings={org.id}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('title')}</h2>
        <p className={styles.muted}>{t('about')}</p>
      </header>

      {tenant.isError && (
        <p role="alert" className={styles.error} data-org-read-error>
          {t('read_failed', { reason: errText(tenant.error) })}
        </p>
      )}

      <Card data-org-card={org.id}>
        <CardContent className={styles.card}>
          <div className={styles.inline}>
            <h3 className={styles.subtitle}>{name}</h3>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)} data-org-rename>
              {t('rename')}
            </Button>
          </div>
          <ul className={styles.rows}>
            <li>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('id')}</div>
                <code className={styles.mono}>{org.id}</code>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(org.id)}>
                {t('copy')}
              </Button>
            </li>
            <li>
              <LogoControl orgId={org.id} t={t} />
            </li>
            <li data-org-mode-row>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('mode')}</div>
                {tenant.data ? (
                  <div className={styles.inline}>
                    <Badge variant={selfManaged ? 'warning' : 'info'}>
                      {selfManaged ? t('self_managed') : t('managed')}
                    </Badge>
                    {requested && <Badge variant="info">{t('conversion_requested')}</Badge>}
                  </div>
                ) : (
                  <span className={styles.sub}>{tenant.isError ? t('unknown') : t('reading')}</span>
                )}
              </div>
              {tenant.data && meKnown &&
                (mode.kind === 'inside' ? (
                  <span className={styles.sub} title={t('requested_inside_hint')} data-org-mode-inside>
                    {t('requested_inside')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    title={t('mode_hint')}
                    onClick={() => (mode.confirm ? setAskingMode(true) : void request())}
                    data-org-mode
                  >
                    {mode.target === 'managed' ? t('to_managed') : t('to_self_managed')}
                  </Button>
                ))}
            </li>
            <li>
              <div className={styles.grow}>
                <div className={styles.sub}>{t('workspaces')}</div>
                <div>
                  {workspaces.data
                    ? t.count('workspace_count', workspaces.data.items.length)
                    : workspaces.isError
                      ? t('unknown')
                      : t('reading')}
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => openScreen(bridge, '/organization/workspaces')}>
                {t('open_workspaces')}
              </Button>
            </li>
          </ul>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card data-org-admin-links>
        <CardContent className={styles.card}>
          <h3 className={styles.subtitle}>{t('admin_title')}</h3>
          <p className={styles.muted}>{t('admin_about')}</p>
          <ul className={styles.rows}>
            {ADMIN_LINKS.map((link) => (
              <li key={link.key}>
                <div className={styles.grow}>
                  <div className={styles.name}>{t(`admin_${link.key}`)}</div>
                  <div className={styles.sub}>{t(`admin_${link.key}_about`)}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openScreen(bridge, link.route)}
                  data-org-admin-link={link.key}
                >
                  {t('open')}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {meKnown && !isHome && (
        <Card className={styles.danger} data-org-danger>
          <CardContent className={styles.card}>
            <h3 className={styles.subtitle}>{t('danger_zone')}</h3>
            <ul className={styles.rows}>
              <li>
                <div className={styles.grow}>
                  <div className={styles.name}>{t('delete')}</div>
                  <div className={styles.sub}>{t('delete_about')}</div>
                </div>
                <Button variant="destructive" onClick={() => setDeleting(true)} data-org-delete>
                  {t('delete')}
                </Button>
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      <NameDialog
        open={renaming}
        title={t('rename_title')}
        fieldLabel={t('rename_field')}
        initial={name}
        saveLabel={t('save')}
        savingLabel={t('saving')}
        labels={labels}
        container={container}
        onSave={async (next) => {
          await accounts.renameTenant(org.id).fetch({ name: next });
          await tenant.refetch();
        }}
        onClose={() => setRenaming(false)}
      />
      <ConfirmDialog
        open={askingMode}
        title={t('self_managed_confirm_title', { name })}
        body={t('self_managed_confirm')}
        confirmLabel={t('to_self_managed')}
        labels={labels}
        container={container}
        onConfirm={request}
        onClose={() => setAskingMode(false)}
      />
      <ConfirmDialog
        open={deleting}
        title={t('delete_confirm', { name })}
        body={t('delete_confirm_body')}
        confirmLabel={t('delete')}
        labels={labels}
        container={container}
        onConfirm={async () => {
          await accounts.deleteTenant(org.id).fetch(undefined);
          setDeleted(true);
        }}
        onClose={() => setDeleting(false)}
      />
    </div>
  );
};

OrganizationSettings.displayName = 'OrganizationSettings';

/** Set or remove the organization's logo. The backend says who may; anybody else is told so. */
const LogoControl: React.FC<{ orgId: string; t: Text }> = ({ orgId, t }) => {
  const settings = apiRegistry.getService(OrganizationSettingsApiService);
  const input = useRef<HTMLInputElement | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    settings
      .logo({ orgId })
      .fetch({ staleTime: 0 })
      .then(
        (l) => live && setLogo(logoSrc(l)),
        // None (404), or not readable here: the initial is shown either way.
        () => live && setLogo(null)
      );
    return () => {
      live = false;
    };
  }, [settings, orgId]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) {
      setError(
        problem.kind === 'type' ? t('logo_bad_type') : t('logo_too_big', { size: problem.sizeKb, max: problem.maxKb })
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = base64Of(new Uint8Array(await file.arrayBuffer()));
      setLogo(logoSrc(await settings.setLogo(orgId).fetch({ content_type: file.type, data })));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await settings.deleteLogo(orgId).fetch(undefined);
      setLogo(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {logo ? <img className={styles.logo} src={logo} alt="" data-org-logo-image /> : <span className={styles.logo} />}
      <div className={styles.grow}>
        <div className={styles.sub}>{t('logo')}</div>
        <div className={styles.sub}>{t('logo_about')}</div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={LOGO_TYPES.join(',')}
        hidden
        data-org-logo-input
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()} data-org-logo>
        {busy ? t('saving') : logo ? t('logo_change') : t('logo_add')}
      </Button>
      {logo && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()} data-org-logo-remove>
          {t('logo_remove')}
        </Button>
      )}
    </>
  );
};

LogoControl.displayName = 'LogoControl';
