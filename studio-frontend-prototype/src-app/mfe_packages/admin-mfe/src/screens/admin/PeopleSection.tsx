/**
 * Admin › People — the prototype's `OrgMembersView` (`org-admin.tsx`) carried
 * over (ADR-0069): one organization's members as studio-user holds them (the
 * authority for who belongs, ADR-0011 §2) — role, standing, how they joined,
 * when last seen — and, under a row, every way they sign in, every account
 * attributed to them and how the organization describes them. An owner or a
 * platform administrator changes a role, suspends, resumes or removes; anyone
 * with an identity can be added when the identity directory answers (it
 * answers a platform administrator only); an invitation goes by e-mail.
 *
 * Who may is the backend's to say: a refused write shows its refusal.
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { responseStatus, useOrganization, type OrganizationRef } from '@constructor-studio/mfe-shared';
import { AdminApiService } from '../../api/AdminApiService';
import type {
  MemberIdentities,
  MembershipRole,
  OrgInvitation,
  OrgMember,
  PersonEmail,
  PlatformIdentity,
} from '../../api/types';
import { directoryLine, initials, memberName, otherEmails, primaryEmail } from '../../model/members';
import { ErrorLine, Header, day, errText, shortId, useAdmin, useConfirm, when } from './common';
import styles from './Admin.module.css';

const ROLES: MembershipRole[] = ['owner', 'admin', 'member'];

export function PeopleSection() {
  const { t } = useAdmin();
  const { org, loading } = useOrganization();
  if (loading) return <p className={styles.muted}>{t('reading')}</p>;
  if (!org) return <p className={styles.muted}>{t('people_pick_org')}</p>;
  // Keyed by the organization: another organization is another read, from nothing.
  return <Members key={org.id} org={org} />;
}

/** Instants the rows compare against, kept in state: never read the clock while rendering. */
function useNow(): number {
  const [now] = useState(() => Date.now());
  return now;
}

function Members({ org }: { org: OrganizationRef }) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [ask, confirmDialog] = useConfirm();
  const now = useNow();
  const [members, setMembers] = useState<OrgMember[] | null>(null);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  /** The identity directory: a platform administrator's alone. `null` until it answered. */
  const [identities, setIdentities] = useState<PlatformIdentity[] | null>(null);
  /** Why the directory could not be read, when it was not a refusal. */
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [standing, setStanding] = useState<'' | 'active' | 'suspended'>('');
  const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState<MembershipRole>('member');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [tick, setTick] = useState(0);
  const load = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.orgMembers(org.id),
      api
        .invitations({ orgId: org.id })
        .fetch({ staleTime: 0 })
        .then((r) => r.items)
        .catch(() => [] as OrgInvitation[]),
    ]).then(
      ([list, invited]) => {
        if (!live) return;
        setMembers(list);
        setInvitations(invited);
        setReadError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setMembers([]);
        setReadError(errText(e));
      }
    );
    return () => {
      live = false;
    };
  }, [api, org.id, tick]);

  // Only a platform administrator reads the directory; anybody else is
  // refused, and then invites by e-mail.
  useEffect(() => {
    let live = true;
    api.platformIdentities.fetch({ staleTime: 0 }).then(
      (r) => live && setIdentities(r.items),
      (e: unknown) => {
        if (!live) return;
        setIdentities(null);
        // Refused: not a platform administrator, nothing to say. Anything else
        // is a directory that is not available here.
        const status = responseStatus(e);
        setDirectoryError(status === 401 || status === 403 || status === 404 ? null : errText(e));
      }
    );
    return () => {
      live = false;
    };
  }, [api]);

  /** One write, then the room as the server now has it. */
  const act = async (key: string, write: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await write();
      load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  const setStandingOf = (m: OrgMember, role: MembershipRole, status: 'active' | 'suspended') =>
    act(m.user_id, () => api.putMembership(m.user_id, org.id).fetch({ role, status }));

  const addIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    const who = identities?.find((i) => i.id === pick);
    if (!who) return;
    await act('add', async () => {
      const { user_id } = await api.resolvePerson.fetch({
        provider: 'keycloak',
        subject: who.id,
        display_name: who.display_name || who.username,
        email: who.email,
      });
      await api.putMembership(user_id, org.id).fetch({ role: pickRole, source: 'assignment' });
    });
    setPick('');
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    await act('invite', () => api.invite(org.id).fetch({ email: email.trim(), role: inviteRole }));
    setEmail('');
  };

  const list = members ?? [];
  const known = new Set(
    list.flatMap((m) => [m.email?.toLowerCase(), m.display_name?.toLowerCase()]).filter(Boolean)
  );
  const addable = (identities ?? []).filter(
    (i) => !known.has(i.email?.toLowerCase()) && !known.has((i.display_name || i.username).toLowerCase())
  );
  const directory = new Map((identities ?? []).map((i) => [i.id, i]));
  const byId = new Map(list.map((m) => [m.user_id, m]));
  const nameOfId = (userId: string) => {
    const m = byId.get(userId);
    return m ? memberName(m) : undefined;
  };
  const pending = invitations.filter((i) => !i.accepted_at_epoch_ms && i.expires_at_epoch_ms > now);
  const activeOwners = list.filter((m) => m.role === 'owner' && m.status === 'active').length;
  const q = query.trim().toLowerCase();
  const shown = list
    .filter((m) => !standing || m.status === standing)
    .filter(
      (m) =>
        !q ||
        [m.display_name, ...(m.emails?.map((x) => x.address) ?? [m.email]), m.role, m.status, directoryLine(m.directory, nameOfId)]
          .filter((s): s is string => !!s)
          .some((s) => s.toLowerCase().includes(q))
    )
    .sort((a, b) => memberName(a).localeCompare(memberName(b)));
  const roleLabel = (r: string) => (ROLES.includes(r as MembershipRole) ? t(`role_${r}`) : r);
  const sourceLabel = (s: string) =>
    ['creation', 'assignment', 'invitation', 'bootstrap', 'first_login', 'manual'].includes(s) ? t(`joined_${s}`) : s;

  return (
    <>
      <Header
        title={t('people_title', { name: org.name })}
        info={<p>{t('people_about')}</p>}
        status={
          <>
            <span className={`${styles.sub} ${styles.mono}`} title={org.id}>
              {shortId(org.id)}
            </span>
            {list.length > 0 && <Badge variant="secondary">{t.count('people_count', list.length)}</Badge>}
            {list.length > 0 && activeOwners === 0 && <Badge variant="warning">{t('no_owner')}</Badge>}
            {pending.length > 0 && <Badge variant="info">{t.count('people_invited', pending.length)}</Badge>}
          </>
        }
      />

      {error && <ErrorLine>{error}</ErrorLine>}

      <Card data-people-table>
        <CardContent className={styles.cardBody}>
          <div className={styles.toolbar}>
            <Input
              className={styles.search}
              value={query}
              placeholder={t('people_search')}
              aria-label={t('people_search')}
              onChange={(e) => setQuery(e.target.value)}
            />
            {(['', 'active', 'suspended'] as const).map((s) => (
              <Button
                key={s || 'all'}
                size="sm"
                variant={standing === s ? 'secondary' : 'ghost'}
                aria-pressed={standing === s}
                onClick={() => setStanding(s)}
              >
                {s ? t(`standing_${s}`) : t('everyone')}
              </Button>
            ))}
          </div>
          {members === null ? (
            <p className={styles.muted}>{t('reading')}</p>
          ) : readError ? (
            <div className={styles.inline}>
              <ErrorLine>{readError}</ErrorLine>
              <Button size="sm" variant="outline" onClick={load}>
                {t('retry')}
              </Button>
            </div>
          ) : list.length === 0 ? (
            <div>
              <p className={styles.name}>{t('people_empty')}</p>
              <p className={styles.muted}>{t('people_empty_hint')}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('people_col_person')}</TableHead>
                  <TableHead>{t('people_col_position')}</TableHead>
                  <TableHead>{t('people_col_role')}</TableHead>
                  <TableHead>{t('people_col_standing')}</TableHead>
                  <TableHead>{t('people_col_seen')}</TableHead>
                  <TableHead>{t('people_col_joined')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((m) => {
                  const suspended = m.status === 'suspended';
                  const onlyOwner = m.role === 'owner' && !suspended && activeOwners <= 1;
                  const line = directoryLine(m.directory, nameOfId);
                  const others = otherEmails(m);
                  const first = primaryEmail(m);
                  return (
                    <React.Fragment key={m.user_id}>
                      <TableRow data-member={m.user_id}>
                        <TableCell>
                          <div className={styles.person}>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-expanded={open === m.user_id}
                              aria-label={t('people_details', { name: memberName(m) })}
                              onClick={() => setOpen(open === m.user_id ? null : m.user_id)}
                            >
                              {open === m.user_id ? '▾' : '▸'}
                            </Button>
                            {m.avatar_url ? (
                              <img className={styles.avatar} src={m.avatar_url} alt="" />
                            ) : (
                              <span className={styles.avatar}>{initials(memberName(m))}</span>
                            )}
                            <div>
                              <div className={styles.name}>{memberName(m)}</div>
                              <div className={styles.sub}>
                                {first && first !== memberName(m) ? first : shortId(m.user_id)}
                                {others.length > 0 && (
                                  <span title={others.map((x) => x.address).join(', ')}> +{others.length}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{line || <span className={styles.sub}>—</span>}</TableCell>
                        <TableCell>
                          <NativeSelect
                            size="sm"
                            aria-label={t('people_role_of', { name: memberName(m) })}
                            value={m.role}
                            disabled={busy !== null || onlyOwner}
                            title={onlyOwner ? t('people_only_owner') : undefined}
                            onChange={(e) => void setStandingOf(m, e.target.value as MembershipRole, m.status)}
                          >
                            {ROLES.map((r) => (
                              <NativeSelectOption key={r} value={r} title={t(`role_${r}_hint`)}>
                                {t(`role_${r}`)}
                              </NativeSelectOption>
                            ))}
                            {!ROLES.includes(m.role as MembershipRole) && (
                              <NativeSelectOption value={m.role}>{m.role}</NativeSelectOption>
                            )}
                          </NativeSelect>
                        </TableCell>
                        <TableCell>
                          <Badge variant={suspended ? 'warning' : 'success'}>
                            {suspended ? t('standing_suspended') : t('standing_active')}
                          </Badge>
                        </TableCell>
                        <TableCell className={styles.sub}>{when(m.last_seen_at_epoch_ms, language)}</TableCell>
                        <TableCell className={styles.sub}>
                          {sourceLabel(m.source)} · {when(m.created_at_epoch_ms, language)}
                        </TableCell>
                        <TableCell>
                          <div className={styles.inline}>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy !== null || (onlyOwner && !suspended)}
                              onClick={() =>
                                void setStandingOf(m, m.role as MembershipRole, suspended ? 'active' : 'suspended')
                              }
                              data-member-standing
                            >
                              {suspended ? t('people_resume') : t('people_suspend')}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null || onlyOwner}
                              onClick={() =>
                                ask(
                                  {
                                    title: t('people_remove_confirm', { name: memberName(m), org: org.name }),
                                    body: t('people_remove_body'),
                                    confirmLabel: t('people_remove'),
                                  },
                                  async () => {
                                    await api.removeMembership(m.user_id, org.id).fetch(undefined);
                                    load();
                                  }
                                )
                              }
                              data-member-remove
                            >
                              {t('people_remove')}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {open === m.user_id && (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <MemberPanel
                              orgId={org.id}
                              member={m}
                              members={list}
                              directory={directory}
                              roleLabel={roleLabel}
                              onSaved={load}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card data-people-add>
        <CardContent className={styles.cardBody}>
          <h3 className={styles.subtitle}>{t('people_add_title')}</h3>
          {identities !== null && (
            <>
              <p className={styles.muted}>{t('people_add_platform_hint')}</p>
              <form className={styles.inline} onSubmit={(e) => void addIdentity(e)}>
                <NativeSelect aria-label={t('people_add_person')} value={pick} onChange={(e) => setPick(e.target.value)}>
                  <NativeSelectOption value="">{t('people_add_someone')}</NativeSelectOption>
                  {addable.map((i) => (
                    <NativeSelectOption key={i.id} value={i.id}>
                      {(i.display_name || i.username) + (i.email ? ` · ${i.email}` : '')}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <NativeSelect
                  aria-label={t('people_col_role')}
                  value={pickRole}
                  onChange={(e) => setPickRole(e.target.value as MembershipRole)}
                >
                  {ROLES.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {t(`role_${r}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button type="submit" disabled={!pick || busy !== null} data-people-add-identity>
                  {busy === 'add' ? t('people_adding') : t('people_add')}
                </Button>
              </form>
            </>
          )}
          {directoryError && (
            <p className={styles.muted}>{t('people_directory_unavailable', { error: directoryError })}</p>
          )}
          <p className={styles.muted}>{t('people_invite_hint')}</p>
          <form className={styles.inline} onSubmit={(e) => void invite(e)}>
            <Input
              className={styles.search}
              type="email"
              aria-label={t('people_invite_email')}
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <NativeSelect
              aria-label={t('people_invite_role')}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
            >
              <NativeSelectOption value="member">{t('role_member')}</NativeSelectOption>
              <NativeSelectOption value="admin">{t('role_admin')}</NativeSelectOption>
            </NativeSelect>
            <Button type="submit" disabled={!email.trim() || busy !== null} data-people-invite>
              {busy === 'invite' ? t('people_inviting') : t('people_invite')}
            </Button>
          </form>

          {pending.length > 0 && (
            <>
              <h4 className={styles.subtitle}>{t('people_waiting')}</h4>
              <ul className={styles.rows}>
                {pending.map((i) => (
                  <li key={i.id} data-invitation={i.id}>
                    <div className={styles.grow}>
                      <div className={styles.name}>{i.email}</div>
                      <div className={styles.sub}>
                        {roleLabel(i.role)} · {t('people_expires', { at: day(i.expires_at_epoch_ms, language) })}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() =>
                        ask(
                          {
                            title: t('people_withdraw_confirm', { email: i.email }),
                            body: t('people_withdraw_body'),
                            confirmLabel: t('people_withdraw'),
                          },
                          async () => {
                            await api.revokeInvitation(org.id, i.id).fetch(undefined);
                            load();
                          }
                        )
                      }
                    >
                      {t('people_withdraw')}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
      {confirmDialog}
    </>
  );
}

/** Everything one member is known by, opened under their row: how the
 *  organization describes them, each address, each way they sign in, and each
 *  external account attributed to them. A platform administrator also sees
 *  what the IdP says about each realm login. */
function MemberPanel({
  orgId,
  member,
  members,
  directory,
  roleLabel,
  onSaved,
}: {
  orgId: string;
  member: OrgMember;
  members: OrgMember[];
  directory: Map<string, PlatformIdentity>;
  roleLabel: (role: string) => string;
  onSaved: () => void;
}) {
  const { t, language } = useAdmin();
  const api = apiRegistry.getService(AdminApiService);
  const [ids, setIds] = useState<MemberIdentities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .memberIdentities({ orgId, userId: member.user_id })
      .fetch({ staleTime: 0 })
      .then(
        (r) => live && setIds(r),
        (e: unknown) => live && setError(errText(e))
      );
    return () => {
      live = false;
    };
  }, [api, orgId, member.user_id]);

  if (error) return <p className={styles.sub}>{t('ids_unreadable', { error })}</p>;
  if (!ids) return <p className={styles.sub}>{t('ids_reading')}</p>;

  const confidence = (c: string) => (['confirmed', 'claimed', 'suggested'].includes(c) ? t(`confidence_${c}`) : c);
  const status = (s: PlatformIdentity['status']) => t(`directory_${s}`);

  return (
    <div className={styles.panel} data-member-panel={member.user_id}>
      <div className={styles.inline}>
        <span className={styles.sub}>{t('ids_person')}</span>
        <code className={styles.mono} title={t('ids_person_hint')}>
          {ids.user_id}
        </code>
        <span className={styles.sub}>{t('ids_since', { at: when(member.created_at_epoch_ms, language) })}</span>
      </div>

      <h4>{t('ids_describe')}</h4>
      <DirectoryForm orgId={orgId} member={member} members={members} onSaved={onSaved} />

      {member.emails && (
        <>
          <h4>
            {t('ids_addresses')} <Badge variant="secondary">{member.emails.length}</Badge>
          </h4>
          <EmailList emails={member.emails} />
        </>
      )}

      <h4>
        {t('ids_logins')} <Badge variant="secondary">{ids.logins.length}</Badge>
      </h4>
      {ids.logins.length === 0 ? (
        <p className={styles.sub}>{t('ids_no_logins')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ids_col_provider')}</TableHead>
              <TableHead>{t('ids_col_account')}</TableHead>
              <TableHead>{t('ids_col_email')}</TableHead>
              <TableHead>{t('ids_col_subject')}</TableHead>
              <TableHead>{t('ids_col_verified')}</TableHead>
              {directory.size > 0 && <TableHead>{t('ids_col_directory')}</TableHead>}
              <TableHead>{t('ids_col_linked')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.logins.map((l) => {
              const idp = l.provider === 'keycloak' ? directory.get(l.subject) : undefined;
              return (
                <TableRow key={`${l.provider}:${l.subject}`}>
                  <TableCell>
                    {l.provider === 'keycloak' ? t('ids_keycloak') : l.provider}
                    {idp && <div className={styles.sub}>{t('ids_via', { idp: idp.identity_provider || 'password' })}</div>}
                  </TableCell>
                  <TableCell>
                    {idp ? (
                      <>
                        <div>{idp.display_name || idp.username}</div>
                        <div className={styles.sub}>{[idp.username, idp.email].filter(Boolean).join(' · ')}</div>
                      </>
                    ) : (
                      <span className={styles.sub}>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {l.email ? (
                      <>
                        <div>{l.email}</div>
                        <div className={styles.sub}>{l.email_verified ? t('ids_email_verified') : t('ids_email_unverified')}</div>
                      </>
                    ) : (
                      <span className={styles.sub}>—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <code className={styles.mono} title={l.subject}>
                      {l.subject}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={l.verified ? 'success' : 'warning'}>{l.verified ? t('verified') : t('unverified')}</Badge>
                  </TableCell>
                  {directory.size > 0 && (
                    <TableCell>
                      {idp ? (
                        <>
                          <div>{status(idp.status)}</div>
                          {idp.home_tenant_name && (
                            <div className={styles.sub}>
                              {t('ids_home', { name: idp.home_tenant_name })}
                              {idp.organization_role ? ` · ${roleLabel(idp.organization_role)}` : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className={styles.sub}>{t('ids_not_in_directory')}</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className={styles.sub}>{when(l.linked_at_epoch_ms, language)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <h4>
        {t('ids_aliases')} <Badge variant="secondary">{ids.aliases.length}</Badge>
      </h4>
      {ids.aliases.length === 0 ? (
        <p className={styles.sub}>{t('ids_no_aliases')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('ids_col_kind')}</TableHead>
              <TableHead>{t('ids_col_account')}</TableHead>
              <TableHead>{t('ids_col_confidence')}</TableHead>
              <TableHead>{t('ids_col_counts')}</TableHead>
              <TableHead>{t('ids_col_added')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.aliases.map((a) => (
              <TableRow key={`${a.kind}:${a.external_id}`}>
                <TableCell>{a.kind}</TableCell>
                <TableCell>
                  <code className={styles.mono}>{a.external_id}</code>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={a.confidence === 'confirmed' ? 'success' : a.confidence === 'claimed' ? 'info' : 'secondary'}
                    title={['confirmed', 'claimed', 'suggested'].includes(a.confidence) ? t(`confidence_${a.confidence}_hint`) : undefined}
                  >
                    {confidence(a.confidence)}
                  </Badge>
                </TableCell>
                <TableCell>{a.attributes ? t('yes') : <span className={styles.sub}>{t('no')}</span>}</TableCell>
                <TableCell className={styles.sub}>{when(a.added_at_epoch_ms, language)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function EmailList({ emails }: { emails: PersonEmail[] }) {
  const { t } = useAdmin();
  if (!emails.length) return <span className={styles.sub}>{t('ids_no_address')}</span>;
  const source = (s: string) => (['profile', 'sign_in', 'alias'].includes(s) ? t(`email_source_${s}`) : s);
  return (
    <ul className={styles.rows}>
      {emails.map((e) => (
        <li key={e.address}>
          <span>{e.address}</span> <span className={styles.sub}>{source(e.source)}</span>
          {e.primary && <Badge variant="info">{t('primary')}</Badge>}
          <Badge variant={e.verified ? 'success' : 'secondary'}>{e.verified ? t('verified') : t('unverified')}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** How the organization describes a member: title, department, company, manager. */
function DirectoryForm({
  orgId,
  member,
  members,
  onSaved,
}: {
  orgId: string;
  member: OrgMember;
  members: OrgMember[];
  onSaved: () => void;
}) {
  const { t } = useAdmin();
  const initial = member.directory ?? {};
  const [affiliation, setAffiliation] = useState(initial.affiliation ?? '');
  const [department, setDepartment] = useState(initial.department ?? '');
  const [title, setTitle] = useState(initial.title ?? '');
  const [reportsTo, setReportsTo] = useState(initial.reports_to ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiRegistry
        .getService(AdminApiService)
        .putMembership(member.user_id, orgId)
        .fetch({
          role: member.role as MembershipRole,
          status: member.status,
          directory: { affiliation, department, title, reports_to: reportsTo || null },
        });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} data-member-directory>
      <p className={styles.sub}>{t('dir_hint')}</p>
      <div className={styles.form}>
        <label className={styles.field}>
          <span className={styles.sub}>{t('dir_title')}</span>
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.sub}>{t('dir_department')}</span>
          <Input value={department} maxLength={120} onChange={(e) => setDepartment(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.sub}>{t('dir_company')}</span>
          <Input value={affiliation} maxLength={120} onChange={(e) => setAffiliation(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.sub}>{t('dir_reports_to')}</span>
          <NativeSelect value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
            <NativeSelectOption value="">{t('dir_nobody')}</NativeSelectOption>
            {members
              .filter((m) => m.user_id !== member.user_id)
              .map((m) => (
                <NativeSelectOption key={m.user_id} value={m.user_id}>
                  {memberName(m)}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </label>
      </div>
      <div className={styles.inline}>
        <Button type="submit" size="sm" disabled={busy}>
          {t('dir_save')}
        </Button>
        {saved && <span className={styles.sub}>{t('saved')}</span>}
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
    </form>
  );
}
