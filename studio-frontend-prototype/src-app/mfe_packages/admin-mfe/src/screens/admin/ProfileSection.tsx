/**
 * Profile — the prototype's `ProfileView` (`App.tsx`) with `MyPersonCard` and
 * `MyIdentitiesCard` (`people-profile.tsx`), carried over (ADR-0069): the person
 * Studio knows (photo, name, addresses, memberships), every way they sign in and
 * every account of theirs elsewhere attached to that one person, their own
 * connections in each organization they belong to, and what the sign-in says.
 *
 * Opened from the user menu (a hidden screen of the organization level, route
 * `/profile`). Everything here is the caller's own: `studio-user`'s `/me` routes
 * and the connections stored as personal. What is not carried and why is in
 * docs/parity.md (the Profile row).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { apiRegistry } from '@gears-frontx/react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@gears-frontx/ui-kit';
import { AccountsApiService, useOrganization, type Me } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type { AliasWrite, MyMembership, PersonAlias, PersonEmail, PersonLogin, StudioProfile } from '../../api/types';
import { initials } from '../../model/members';
import {
  ALIAS_KINDS,
  AVATAR_TYPES,
  CONFIDENCE_TONE,
  aliasConfidence,
  aliasKindLabel,
  avatarRefusal,
  confirmSummary,
  isStoredPhoto,
  loginProvider,
  photoProvider,
  primaryEmail,
  toBase64,
} from '../../model/profile';
import { ErrorLine, Header, errText, shortId, useAdmin, when } from './common';
import { EmailList } from './PeopleSection';
import { Integrations } from './integrations/IntegrationsSection';
import styles from './Admin.module.css';

export function ProfileSection() {
  const { t } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [memberships, setMemberships] = useState<MyMembership[] | null>(null);

  useEffect(() => {
    let live = true;
    api.myMemberships
      .fetch({ staleTime: 0 })
      .then((r) => live && setMemberships(r.items ?? []))
      .catch(() => live && setMemberships([]));
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <>
      <Header title={t('prof_title')} info={<p>{t('prof_about')}</p>} />
      <PersonCard memberships={memberships} />
      <IdentitiesCard />
      <MyConnections memberships={memberships} />
      <SignInDetails />
    </>
  );
}

/** A person's photo, or their initials when there is none or it does not load. */
export function PersonPhoto({ name, url, large = false }: { name: string; url?: string | null; large?: boolean }) {
  // Kept per address, so a new photo gets its own chance to load.
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const broken = !!url && brokenUrl === url;
  const style = large ? { width: '4rem', height: '4rem', fontSize: '1.25rem' } : undefined;
  if (url && !broken)
    return <img className={styles.avatar} style={style} src={url} alt="" onError={() => setBrokenUrl(url)} data-person-photo />;
  return (
    <span className={styles.avatar} style={style} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

function PersonCard({ memberships }: { memberships: MyMembership[] | null }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [profile, setProfile] = useState<StudioProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.myProfile
      .fetch({ staleTime: 0 })
      .then((p) => live && setProfile(p))
      .catch((e: unknown) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [api]);

  const apply = async (write: () => Promise<StudioProfile>) => {
    setBusy(true);
    setError(null);
    try {
      setProfile(await write());
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const refusal = avatarRefusal(file);
    if (refusal) {
      setError(refusal.key === 'prof_photo_size' ? t(refusal.key, { kib: refusal.kib, max: refusal.max }) : t(refusal.key));
      return;
    }
    await apply(async () => {
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      return api.uploadMyAvatar.fetch({ content_type: file.type, data });
    });
  };

  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = editing?.trim();
    if (!next) return;
    if (await apply(() => api.updateMyProfile.fetch({ display_name: next }))) setEditing(null);
  };

  const name = profile?.display_name?.trim() || primaryEmail(profile ?? {}) || t('prof_you');
  const stored = isStoredPhoto(profile?.avatar_url);
  const linkedFrom = stored ? null : photoProvider(profile?.avatar_url);
  const roleLabel = (role: string) => (['owner', 'admin', 'member'].includes(role) ? t(`role_${role}`) : role);

  return (
    <Card data-profile-person>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('prof_you')}</h3>
        {!profile && !error && <p className={styles.muted}>{t('reading')}</p>}
        {profile && (
          <div className={styles.person} style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}>
            <PersonPhoto name={name} url={profile.avatar_url} large />
            <div className={styles.grow} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {editing === null ? (
                <div className={styles.inline}>
                  <span className={styles.name} data-profile-name>
                    {name}
                  </span>
                  <Button size="sm" variant="ghost" title={t('prof_rename_hint')} onClick={() => setEditing(profile.display_name ?? '')}>
                    {t('prof_rename')}
                  </Button>
                </div>
              ) : (
                <form className={styles.inline} onSubmit={(e) => void rename(e)}>
                  <Input
                    autoFocus
                    value={editing}
                    maxLength={200}
                    aria-label={t('prof_your_name')}
                    onChange={(e) => setEditing(e.target.value)}
                  />
                  <Button type="submit" size="sm" disabled={busy || !editing.trim()}>
                    {t('save')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {t('cancel')}
                  </Button>
                </form>
              )}
              {primaryEmail(profile) && <span className={styles.sub}>{primaryEmail(profile)}</span>}
              {profile.last_seen_at_epoch_ms != null && (
                <span className={styles.sub}>{t('prof_last_seen', { when: when(profile.last_seen_at_epoch_ms, language) })}</span>
              )}
              {memberships && memberships.length > 0 && (
                <div className={styles.chips} data-profile-memberships>
                  {memberships.map((m) => (
                    <Badge
                      key={m.org_id}
                      variant={m.status === 'active' ? 'info' : 'warning'}
                      title={m.status === 'active' ? undefined : t('prof_suspended_hint')}
                    >
                      {m.org_name || t('prof_org_short', { id: shortId(m.org_id) })} · {roleLabel(m.role)}
                      {m.status === 'active' ? '' : ` · ${t('standing_suspended').toLowerCase()}`}
                    </Badge>
                  ))}
                </div>
              )}
              <div className={styles.inline}>
                <label className={styles.inline} style={{ cursor: busy ? 'default' : 'pointer' }}>
                  <span className={styles.sub} style={{ textDecoration: 'underline' }}>
                    {stored ? t('prof_photo_replace') : t('prof_photo_upload')}
                  </span>
                  <input
                    type="file"
                    accept={AVATAR_TYPES.join(',')}
                    style={{ display: 'none' }}
                    disabled={busy}
                    onChange={(e) => void upload(e)}
                    data-profile-photo-input
                  />
                </label>
                {stored && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void apply(() => api.deleteMyAvatar.fetch(undefined))}>
                    {t('prof_photo_remove')}
                  </Button>
                )}
                <span className={styles.sub}>
                  {linkedFrom ? t('prof_photo_linked', { provider: linkedFrom }) : t('prof_photo_rules')}
                </span>
              </div>
            </div>
          </div>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </CardContent>
    </Card>
  );
}

function IdentitiesCard() {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const accounts = apiRegistry.getService(AccountsApiService);
  const [logins, setLogins] = useState<PersonLogin[] | null>(null);
  const [aliases, setAliases] = useState<PersonAlias[] | null>(null);
  const [emails, setEmails] = useState<PersonEmail[] | null>(null);
  const [session, setSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<string>('github');
  const [account, setAccount] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([api.myLogins.fetch({ staleTime: 0 }), api.myAliases.fetch({ staleTime: 0 }), api.myProfile.fetch({ staleTime: 0 })])
      .then(([l, a, p]) => {
        if (!live) return;
        setLogins(l.items ?? []);
        setAliases(a.aliases ?? []);
        setEmails(p.emails ?? null);
      })
      .catch((e: unknown) => live && setError(errText(e)));
    accounts.getMe
      .fetch()
      .then((me) => live && setSession(me?.subject_id ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [api, accounts]);

  const run = async (write: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await write();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const written = (w: AliasWrite) => {
    setAliases(w.aliases ?? []);
    if (w.outcome === 'refused') setError(w.reason || t('prof_refused'));
    else if (w.outcome === 'written_over_a_proof') setNote(t('prof_written_over_proof'));
  };

  const claim = (event: React.FormEvent) => {
    event.preventDefault();
    const id = account.trim();
    if (!id) return;
    void run(async () => {
      written(await api.claimMyAlias.fetch({ kind, external_id: id }));
      setAccount('');
    });
  };

  const confirm = () =>
    run(async () => {
      const report = await api.confirmMyAliases.fetch(undefined);
      setAliases((await api.myAliases.fetch({ staleTime: 0 })).aliases ?? []);
      setNote(confirmSummary(report, t));
    });

  return (
    <Card data-profile-identities>
      <CardContent className={styles.cardBody}>
        <div className={styles.header}>
          <h3 className={styles.subtitle}>{t('prof_identities')}</h3>
          <div className={styles.headerAction}>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void confirm()} data-profile-confirm>
              {t('prof_check')}
            </Button>
          </div>
        </div>
        <p className={styles.muted}>{t('prof_identities_about')}</p>
        {error && <ErrorLine>{error}</ErrorLine>}
        {note && (
          <p className={styles.notice} role="status" data-profile-note>
            {note}
          </p>
        )}
        {!logins && !error && <p className={styles.muted}>{t('reading')}</p>}

        {logins && (
          <section>
            <h4 className={styles.name}>{t.count('prof_logins', logins.length)}</h4>
            <ul className={styles.rows}>
              {logins.map((l) => (
                <li key={`${l.provider}:${l.subject}`} data-profile-login={l.provider}>
                  <div className={styles.grow}>
                    <div className={styles.name}>
                      {loginProvider(l.provider, t)}{' '}
                      {l.subject === session && <Badge variant="info">{t('prof_this_session')}</Badge>}
                    </div>
                    <div className={styles.sub}>
                      {l.email
                        ? `${l.email} · ${l.email_verified ? t('ids_email_verified') : t('ids_email_unverified')}`
                        : t('prof_no_provider_address')}
                      {' · '}
                      {t('prof_linked', { when: when(l.linked_at_epoch_ms, language) })}
                    </div>
                  </div>
                  <code className={styles.mono} title={t('prof_subject_hint')}>
                    {shortId(l.subject)}
                  </code>
                </li>
              ))}
            </ul>
          </section>
        )}

        {aliases && (
          <section>
            <h4 className={styles.name}>{t.count('prof_aliases', aliases.length)}</h4>
            {aliases.length === 0 && (
              <p className={styles.muted} data-profile-no-aliases>
                {t('prof_no_aliases')}
              </p>
            )}
            <ul className={styles.rows}>
              {aliases.map((a) => {
                const c = aliasConfidence(a.confidence);
                return (
                  <li key={`${a.kind}:${a.external_id}`} data-profile-alias={`${a.kind}:${a.external_id}`}>
                    <div className={styles.grow}>
                      <div className={styles.name}>
                        {aliasKindLabel(a.kind, t)} · {a.external_id}
                      </div>
                      <div className={styles.sub}>{t('prof_added', { when: when(a.added_at_epoch_ms, language) })}</div>
                    </div>
                    <Badge variant={CONFIDENCE_TONE[c]} title={t(`prof_confidence_${c}_hint`)}>
                      {t(`prof_confidence_${c}`)}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('prof_revoke_hint')}
                      aria-label={t('prof_revoke', { account: a.external_id })}
                      disabled={busy}
                      onClick={() => void run(async () => written(await api.revokeMyAlias.fetch({ kind: a.kind, external_id: a.external_id })))}
                    >
                      ✕
                    </Button>
                  </li>
                );
              })}
            </ul>
            <form className={styles.inline} onSubmit={claim} data-profile-claim>
              <NativeSelect size="sm" value={kind} aria-label={t('prof_account_kind')} onChange={(e) => setKind(e.target.value)}>
                {ALIAS_KINDS.map((k) => (
                  <NativeSelectOption key={k} value={k}>
                    {aliasKindLabel(k, t)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                value={account}
                placeholder={kind === 'email' ? t('prof_address') : t('prof_login')}
                aria-label={t('prof_account')}
                onChange={(e) => setAccount(e.target.value)}
              />
              <Button type="submit" size="sm" disabled={busy || !account.trim()}>
                {t('prof_claim')}
              </Button>
            </form>
          </section>
        )}

        {emails && (
          <section>
            <h4 className={styles.name}>{t.count('prof_addresses', emails.length)}</h4>
            <EmailList emails={emails} />
          </section>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The caller's own connections, in each organization they are an active member
 * of; the organization's and a project's shared ones are on their own pages.
 * Before the memberships answer (or when none could be read) the path bar's
 * organization stands in.
 */
function MyConnections({ memberships }: { memberships: MyMembership[] | null }) {
  const { t } = useAdmin();
  const { org } = useOrganization();
  const orgs =
    memberships && memberships.some((m) => m.status === 'active')
      ? memberships
          .filter((m) => m.status === 'active')
          .map((m) => ({ id: m.org_id, name: m.org_name || t('prof_org_short', { id: shortId(m.org_id) }) }))
      : org
        ? [org]
        : [];
  return (
    <Card data-profile-connections>
      <CardContent className={styles.cardBody}>
        <h3 className={styles.subtitle}>{t('prof_connections')}</h3>
        <p className={styles.muted}>{t('prof_connections_about')}</p>
        {memberships === null ? (
          <p className={styles.muted}>{t('reading')}</p>
        ) : orgs.length === 0 ? (
          <p className={styles.muted}>{t('prof_connections_no_org')}</p>
        ) : (
          orgs.map((o) => <Integrations key={o.id} org={o} personal />)
        )}
      </CardContent>
    </Card>
  );
}

/** For support and debugging: whom the backend resolves this sign-in to. Folded, as nothing in it is acted on. */
function SignInDetails() {
  const { t } = useAdmin();
  const accounts = apiRegistry.getService(AccountsApiService);
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open), []);

  useEffect(() => {
    if (!open || me) return;
    let live = true;
    accounts.getMe
      .fetch()
      .then((r) => live && setMe(r ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accounts, open, me]);

  return (
    <Card data-profile-sign-in>
      <CardContent className={styles.cardBody}>
        <details onToggle={toggle}>
          <summary className={styles.name}>{t('prof_sign_in')}</summary>
          <p className={styles.muted}>{t('prof_sign_in_about')}</p>
          {me && (
            <ul className={styles.rows}>
              <li>
                <span className={styles.sub}>{t('prof_subject')}</span>
                <code className={styles.mono}>{me.subject_id}</code>
                {me.subject_type && <span className={styles.sub}>({me.subject_type})</span>}
              </li>
              {me.subject_tenant_id && (
                <li>
                  <span className={styles.sub}>{t('prof_home_tenant')}</span>
                  <code className={styles.mono}>{me.subject_tenant_id}</code>
                </li>
              )}
              <li>
                <span className={styles.sub}>API</span>
                <a href="/api-docs/">/api-docs/</a>
              </li>
            </ul>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
