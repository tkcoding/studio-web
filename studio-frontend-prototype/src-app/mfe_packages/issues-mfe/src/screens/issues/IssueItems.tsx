/**
 * What opens under an Issues row (the prototype's `QueueItem`, `DocItem` and
 * `IssueForm` in domain-model-screens.tsx at 00828880): the problem with its
 * passages and its actions, a change that makes the documentation better
 * ready to save, and the issue to open for a row. A queue row offers what the
 * server says it offers (`actions`).
 */

import { useState } from 'react';
import { Badge, Button, Input, NativeSelect, NativeSelectOption, Textarea } from '@gears-frontx/ui-kit';
import type { ScreenText } from '@constructor-studio/mfe-shared';
import type {
  DocQualityRow,
  NewIssue,
  SpecModelEntityEdit,
  SpecModelIssueRow,
  SpecModelSentence,
  SpecModelWrite,
} from '../../api/types';
import { issueBody, relationSentence, type IssueRow } from '../../model/issue-rows';
import { codeSpans, sideLabel, type SpecModelSide } from '../../model/spec-model';
import styles from './IssuesScreen.module.css';

export type Text = ScreenText;
export type OpenFile = ((path: string) => void) | undefined;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Text the backend wrote with backticked names, the names set as code. */
export function Prose({ text }: { text: string }) {
  return <>{codeSpans(text).map((s, i) => (s.code ? <code key={i}>{s.text}</code> : s.text))}</>;
}

export function SideLink({ side, onOpenFile, t }: { side: SpecModelSide; onOpenFile: OpenFile; t: Text }) {
  return (
    <div className={styles.side}>
      <button
        type="button"
        className={styles.sidePath}
        disabled={!onOpenFile}
        onClick={() => onOpenFile?.(side.path)}
        title={t('open_in_editor')}
      >
        {sideLabel(side)}
      </button>
      {side.quote && <blockquote className={styles.quote}>{side.quote}</blockquote>}
    </div>
  );
}

function Proposed({ done, t }: { done: SpecModelWrite; t: Text }) {
  return (
    <span className={styles.saved} data-proposed>
      {done.pr_url ? (
        <>
          ✓ {t('proposed')}{' '}
          <a href={done.pr_url} target="_blank" rel="noreferrer">
            {t('as_pull_request')}
          </a>
        </>
      ) : (
        <>✓ {t('proposed_on', { branch: done.branch })}</>
      )}
    </span>
  );
}

/** One thing to decide from the server's queue. */
export function QueueItem({
  item,
  kindLabel,
  onDecide,
  onPropose,
  onOpenFile,
  t,
}: {
  item: SpecModelIssueRow;
  kindLabel: string;
  onDecide: (item: SpecModelIssueRow, d: 'confirmed' | 'dismissed') => Promise<void>;
  onPropose: (item: SpecModelIssueRow) => Promise<SpecModelWrite>;
  onOpenFile: OpenFile;
  t: Text;
}) {
  const [proposal, setProposal] = useState<{ busy: boolean; done?: SpecModelWrite; error?: string } | null>(null);
  const [deciding, setDeciding] = useState(false);
  const can = (a: SpecModelIssueRow['actions'][number]) => item.actions.includes(a);
  const finding = item.kind === 'finding';
  const propose = async () => {
    setProposal({ busy: true });
    try {
      setProposal({ busy: false, done: await onPropose(item) });
    } catch (e) {
      setProposal({ busy: false, error: message(e) });
    }
  };
  const decide = (d: 'confirmed' | 'dismissed') => {
    setDeciding(true);
    void onDecide(item, d).finally(() => setDeciding(false));
  };
  const first = item.sides[0];
  return (
    <article className={`${styles.item}${item.done ? ` ${styles.done}` : ''}`} data-item={item.key}>
      <header className={styles.itemHead}>
        <Badge variant={item.tone === 'bad' ? 'danger' : 'warning'}>{kindLabel}</Badge>
        <b>
          <Prose text={item.title} />
        </b>
      </header>
      <div className={styles.hint}>{item.hint}</div>
      <div className={styles.sides}>
        {item.sides.slice(0, 3).map((s, i) => (
          <SideLink key={i} side={s} onOpenFile={onOpenFile} t={t} />
        ))}
        {item.sides.length > 3 && <div className={styles.hint}>{t.count('more_places', item.sides.length - 3)}</div>}
      </div>
      {item.edit && (
        <div className={styles.fix}>
          <span className={styles.hint}>{t('fix_in', { path: item.edit.path })}</span>
          <del>{item.edit.replace}</del>
          <ins>{item.edit.with}</ins>
        </div>
      )}
      {finding && !item.edit && item.decide.length > 0 && (
        <div className={styles.fix}>
          <span className={styles.hint}>{t('choose')}</span>
          <ul>
            {item.decide.map((o) => (
              <li key={o}>
                <Prose text={o} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className={styles.actions}>
        {finding ? (
          item.done ? (
            <span className={styles.hint} data-decided>
              {item.decision === 'confirmed' ? t('marked_real') : t('marked_fine')}
            </span>
          ) : (
            <>
              {can('propose_fix') && !proposal?.done && (
                <Button size="sm" disabled={proposal?.busy} onClick={() => void propose()} title={t('propose_title')}>
                  {proposal?.busy ? t('proposing') : t('propose')}
                </Button>
              )}
              {proposal?.done && <Proposed done={proposal.done} t={t} />}
              {proposal?.error && <span className={styles.errorInline}>{proposal.error}</span>}
              {first && onOpenFile && (
                <Button
                  size="sm"
                  variant={can('propose_fix') ? 'ghost' : 'default'}
                  onClick={() => onOpenFile(first.path)}
                >
                  {t('fix_in_editor')}
                </Button>
              )}
              {can('confirm') && (
                <Button size="sm" variant="ghost" disabled={deciding} onClick={() => decide('confirmed')} title={t('real_title')}>
                  {t('real')}
                </Button>
              )}
              {can('dismiss') && (
                <Button size="sm" variant="ghost" disabled={deciding} onClick={() => decide('dismissed')} title={t('fine_title')}>
                  {t('fine')}
                </Button>
              )}
            </>
          )
        ) : (
          first &&
          onOpenFile && (
            <Button size="sm" onClick={() => onOpenFile(first.path)}>
              {item.kind === 'question' ? t('answer_it') : item.kind === 'assumption' ? t('say_how_checked') : t('add_source')}
            </Button>
          )
        )}
      </div>
    </article>
  );
}

/** A change that makes the documentation better, ready to save. */
export function DocItem({
  item,
  kindLabel,
  onSave,
  onSameThing,
  onProposeSentence,
  onOpenFile,
  t,
}: {
  item: DocQualityRow;
  kindLabel: string;
  onSave: (edit: SpecModelEntityEdit) => Promise<SpecModelWrite>;
  onSameThing: (alias: string, of: string) => Promise<void>;
  onProposeSentence: (s: SpecModelSentence) => Promise<SpecModelWrite>;
  onOpenFile: OpenFile;
  t: Text;
}) {
  const [edit, setEdit] = useState(item.edit ?? null);
  const [verb, setVerb] = useState(item.sentence?.verb ?? '');
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: SpecModelWrite }>({ busy: false });
  const run = async (act: () => Promise<unknown>) => {
    setState({ busy: true });
    try {
      const done = await act();
      setState({ busy: false, done: item.sentence ? (done as SpecModelWrite) : undefined });
    } catch (e) {
      setState({ busy: false, error: message(e) });
    }
  };
  // The relation a one-sided item adds is the last of the draft's.
  const added = item.kind === 'onesided' && edit ? edit.relations[edit.relations.length - 1] : null;
  const pair = item.pair;
  const sentence = item.sentence;
  return (
    <article className={styles.item} data-item={item.key}>
      <header className={styles.itemHead}>
        <Badge variant="warning">{kindLabel}</Badge>
        <b>{item.title}</b>
      </header>
      <div className={styles.hint}>{item.hint}</div>
      {item.sides.length > 0 && (
        <div className={styles.sides}>
          {item.sides.map((s, i) => (
            <SideLink key={i} side={s} onOpenFile={onOpenFile} t={t} />
          ))}
        </div>
      )}
      {edit && !added && (
        <label className={styles.field}>
          <span>{t('definition_label', { name: edit.name })}</span>
          <Textarea
            rows={2}
            value={edit.definition ?? ''}
            onChange={(e) => setEdit({ ...edit, definition: e.target.value })}
          />
        </label>
      )}
      {sentence && (
        <div className={styles.field}>
          <span>{t('sentence_added', { path: sentence.path, line: sentence.line })}</span>
          <div className={styles.inverse}>
            <b>{sentence.name}</b>
            <Input aria-label={t('verb')} value={verb} onChange={(e) => setVerb(e.target.value)} />
            <b>{sentence.target}</b>
          </div>
          <blockquote className={styles.quote}>{relationSentence(sentence.name, verb, sentence.target)}</blockquote>
        </div>
      )}
      {edit && added && (
        <div className={styles.field}>
          <span>{t('relation_added', { name: edit.name })}</span>
          <div className={styles.inverse}>
            <b>{edit.name}</b>
            <Input
              aria-label={t('verb')}
              value={added.verb}
              onChange={(e) =>
                setEdit({ ...edit, relations: edit.relations.map((r) => (r === added ? { ...r, verb: e.target.value } : r)) })
              }
            />
            <b>{added.target}</b>
          </div>
        </div>
      )}
      <div className={styles.actions}>
        {edit && (
          <Button
            size="sm"
            disabled={state.busy || (added ? !added.verb.trim() : !edit.definition?.trim())}
            onClick={() => void run(() => onSave({ ...edit, definition: edit.definition?.trim() || null }))}
            title={t('save_title')}
          >
            {state.busy
              ? t('saving')
              : item.kind === 'nodefinition'
                ? t('save_definition')
                : item.kind === 'onesided'
                  ? t('add_other_side')
                  : t('add_to_model')}
          </Button>
        )}
        {sentence && !state.done && (
          <Button
            size="sm"
            disabled={state.busy || !verb.trim()}
            onClick={() =>
              void run(() =>
                onProposeSentence({
                  path: sentence.path,
                  revision: sentence.revision,
                  line: sentence.line,
                  sentence: relationSentence(sentence.name, verb, sentence.target),
                  why: `say how ${sentence.name} relates to ${sentence.target}`,
                })
              )
            }
            title={t('propose_sentence_title')}
          >
            {state.busy ? t('proposing') : t('propose')}
          </Button>
        )}
        {state.done && <Proposed done={state.done} t={t} />}
        {pair && (
          <Button
            size="sm"
            disabled={state.busy}
            onClick={() => void run(() => onSameThing(pair.b.key, pair.a.key))}
            title={t('same_thing_title', { b: pair.b.name, a: pair.a.name })}
          >
            {t('same_thing')}
          </Button>
        )}
        {state.error && <span className={styles.errorInline}>{state.error}</span>}
      </div>
    </article>
  );
}

/** The issue to open for a row: its title and text, editable, and who it is for. */
export function IssueForm({
  row,
  people,
  onCreate,
  onCancel,
  t,
}: {
  row: IssueRow;
  people: { name: string; login: string }[];
  onCreate: (issue: NewIssue) => Promise<unknown>;
  onCancel: () => void;
  t: Text;
}) {
  const [title, setTitle] = useState(row.title.slice(0, 240));
  const [body, setBody] = useState(() => issueBody(row));
  const [assignee, setAssignee] = useState('');
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  return (
    <div className={styles.issueForm} data-issue-form>
      <label className={styles.field}>
        <span>{t('issue_title')}</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={styles.field}>
        <span>{t('issue_description')}</span>
        <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className={styles.actions}>
        <label className={styles.inline}>
          {t('assign_to')}
          <NativeSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label={t('assign_to')}>
            <NativeSelectOption value="">{t('nobody_yet')}</NativeSelectOption>
            {people.map((p) => (
              <NativeSelectOption key={p.login} value={p.login}>
                {p.name} (@{p.login})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {people.length === 0 && <span className={styles.hint}>{t('no_github_logins')}</span>}
        <Button
          size="sm"
          disabled={state.busy || !title.trim()}
          onClick={() => {
            setState({ busy: true });
            onCreate({ title: title.trim(), body, assignees: assignee ? [assignee] : [] }).catch((e: unknown) =>
              setState({ busy: false, error: message(e) })
            );
          }}
        >
          {state.busy ? t('opening') : t('open_issue')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        {state.error && <span className={styles.errorInline}>{state.error}</span>}
      </div>
    </div>
  );
}
