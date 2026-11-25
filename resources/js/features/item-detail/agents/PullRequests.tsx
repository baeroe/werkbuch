/*
 * The pull requests linked to an item (WEBU-28, port of the clickdummy, spec 10.6 and 12): number, title (a link to
 * GitHub), state (open, draft, merged, closed), the CI of its head commit and its checks, the verdict of the review,
 * who opened it (an agent's PR names its bot), the branches, and whether it closes the item on merge. Without PRs the
 * section only shows in a project with a repo, and says how a PR gets here.
 */

import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import { useUserMap } from '@/components/fields/itemData';
import { cx } from '@/components/ui/cx';
import { Badge } from '@/features/settings/frame/parts';
import { t, type TranslationKey } from '@/lib/i18n';
import type { AgentRun, LinkCheck, WorkItem, WorkItemLink } from '@/types';
import { Section } from '../shared';

type Look = { label: string; icon: LucideIcon; className: string };

function stateOf(pr: WorkItemLink): Look {
  if (pr.state === 'merged') return { label: t('items.prs.state.merged'), icon: GitMerge, className: 'text-st-completed' };
  if (pr.state === 'closed') return { label: t('items.prs.state.closed'), icon: GitPullRequestClosed, className: 'text-st-canceled' };
  if (pr.draft) return { label: t('items.prs.state.draft'), icon: GitPullRequestDraft, className: 'text-muted' };
  return { label: t('items.prs.state.open'), icon: GitPullRequest, className: 'text-accent-text' };
}

/** Conclusions that hold a PR back, in words; any other finished one that is no success, skip or neutral is red. */
const RED_WORDS: Record<string, TranslationKey> = {
  cancelled: 'items.prs.check.cancelled',
  timed_out: 'items.prs.check.timed_out',
  action_required: 'items.prs.check.action_required',
  stale: 'items.prs.check.stale',
  error: 'items.prs.check.error',
};

/** A check, a workflow run or a commit status of the head commit. */
function checkOf(check: LinkCheck): Look {
  if (check.status !== 'completed') {
    return check.status === 'queued' || check.status === 'pending' || check.status === 'waiting' || check.status === 'requested'
      ? { label: t('items.prs.check.queued'), icon: CircleDashed, className: 'text-muted' }
      : { label: t('items.prs.check.running'), icon: CircleDot, className: 'text-accent-text' };
  }
  if (check.conclusion === 'success') return { label: t('items.prs.check.success'), icon: CircleCheck, className: 'text-st-completed' };
  if (check.conclusion === 'skipped') return { label: t('items.prs.check.skipped'), icon: CircleMinus, className: 'text-muted' };
  if (check.conclusion === 'neutral') return { label: t('items.prs.check.neutral'), icon: CircleMinus, className: 'text-muted' };
  const word = RED_WORDS[check.conclusion ?? ''];
  return { label: word ? t(word) : t('items.prs.check.failure'), icon: CircleX, className: 'text-danger' };
}

const CI: Record<WorkItemLink['ci'], { label: TranslationKey; tone: 'neutral' | 'danger' | 'quiet' | 'accent' }> = {
  none: { label: 'items.prs.ci.none', tone: 'quiet' },
  pending: { label: 'items.prs.ci.pending', tone: 'accent' },
  success: { label: 'items.prs.ci.success', tone: 'neutral' },
  failure: { label: 'items.prs.ci.failure', tone: 'danger' },
};

function PullRequestRow({ pr, botId }: { pr: WorkItemLink; botId: string | null }) {
  const users = useUserMap();
  const state = stateOf(pr);
  const ci = CI[pr.ci];
  const bot = botId === null ? undefined : users.get(botId);
  const agent = pr.thread_id !== null;
  const author = agent ? t('items.prs.agent', { name: bot?.name ?? pr.author }) : pr.author;
  const active = pr.state === 'open' && !pr.draft;
  return (
    <li className="flex gap-2.5 py-2">
      <state.icon className={cx('mt-0.5 size-4 shrink-0', state.className)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <a href={pr.url} target="_blank" rel="noreferrer" className="group inline-flex max-w-full items-baseline gap-1.5 text-ui text-ink no-underline">
          <span className="shrink-0 text-muted tabular-nums">#{pr.number}</span>
          <span className="min-w-0 font-medium break-words group-hover:underline" translate="no">
            {pr.title}
          </span>
          <ExternalLink className="size-3.5 shrink-0 self-center text-muted" aria-hidden="true" />
          <span className="sr-only">{t('items.prs.opens_github')}</span>
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge tone={active ? 'accent' : 'quiet'}>{state.label}</Badge>
          {active && <Badge tone={ci.tone}>{t(ci.label)}</Badge>}
          {pr.review === 'approve' && <Badge icon={CircleCheck}>{agent ? t('items.prs.review.clean') : t('items.prs.review.approve')}</Badge>}
          {pr.review === 'changes' && <Badge tone="danger">{t('items.prs.review.changes')}</Badge>}
          <span className="text-muted">{t('items.prs.by', { author })}</span>
          <span className="min-w-0 text-muted">
            <span translate="no" className="break-all">
              {pr.head_branch}
            </span>{' '}
            {t('items.prs.into')} <span translate="no">{pr.base_branch}</span>
          </span>
          <span className="text-muted">{pr.closes ? t('items.prs.closes') : t('items.prs.links')}</span>
        </div>
        {pr.checks.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={t('items.prs.checks', { number: pr.number })}>
            {pr.checks.map((check, index) => {
              const look = checkOf(check);
              return (
                <li key={`${check.name}:${index}`} className="inline-flex items-center gap-1">
                  <look.icon className={cx('size-3.5 shrink-0', look.className)} aria-hidden="true" />
                  <span className="text-ink" translate="no">
                    {check.name}
                  </span>
                  <span className="sr-only">{look.label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {pr.draft && pr.state === 'open' && <p className="mt-1 text-sm text-pretty text-muted">{t('items.prs.draft_hint')}</p>}
      </div>
    </li>
  );
}

/** `runs` tell which bot works on a strand: an agent's PR names it. */
export function PullRequests({ item, links, repository, runs }: { item: WorkItem; links: readonly WorkItemLink[]; repository: boolean; runs: readonly AgentRun[] }) {
  if (links.length === 0 && !repository) return null;
  const botOf = (threadId: string | null) => (threadId === null ? null : (runs.find((run) => run.thread_id === threadId)?.bot_id ?? null));
  return (
    <Section title={t('items.prs.title')} aside={links.length > 0 ? String(links.length) : undefined}>
      {links.length === 0 ? (
        <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">{t('items.prs.empty', { key: item.key })}</p>
      ) : (
        <ul className="mt-1 divide-y divide-line" aria-label={t('items.prs.list', { key: item.key })}>
          {links.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} botId={botOf(pr.thread_id)} />
          ))}
        </ul>
      )}
    </Section>
  );
}
