/*
 * The pull requests linked to an item (WEBU-18, spec 10.5 and 12): number, title, state (open, draft, merged,
 * closed), who opened it, the branch, the checks of its head commit, the verdict of the review, and whether it closes
 * the item on merge. A PR is linked when its title, body or branch names the key; a draft triggers nothing. Without
 * PRs the section only shows in a project with a repo, and says how a PR gets here.
 */

import type { LucideIcon } from 'lucide-react';
import { CircleCheck, CircleDashed, CircleDot, CircleMinus, CircleX, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react';
import { useUserMap } from '@/components/fields/itemData';
import { cx } from '@/components/ui/cx';
import { Badge } from '@/features/settings/org/parts';
import { useItemAgents, useProjectAgents } from '@/hooks/agents';
import type { PullRequestCheck, PullRequestLink, WorkItem } from '@/types';
import { Section } from './shared';

function stateOf(pr: PullRequestLink): { label: string; icon: LucideIcon; className: string } {
  if (pr.state === 'merged') return { label: 'Gemergt', icon: GitMerge, className: 'text-st-completed' };
  if (pr.state === 'closed') return { label: 'Geschlossen', icon: GitPullRequestClosed, className: 'text-st-canceled' };
  if (pr.draft) return { label: 'Entwurf', icon: GitPullRequestDraft, className: 'text-muted' };
  return { label: 'Offen', icon: GitPullRequest, className: 'text-accent-text' };
}

function checkOf(check: PullRequestCheck): { label: string; icon: LucideIcon; className: string } {
  if (check.status !== 'completed') return check.status === 'queued' ? { label: 'wartet', icon: CircleDashed, className: 'text-muted' } : { label: 'läuft', icon: CircleDot, className: 'text-accent-text' };
  if (check.conclusion === 'success') return { label: 'grün', icon: CircleCheck, className: 'text-st-completed' };
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') return { label: check.conclusion === 'skipped' ? 'übersprungen' : 'neutral', icon: CircleMinus, className: 'text-muted' };
  return { label: RED_WORDS[check.conclusion ?? 'failure'] ?? 'rot', icon: CircleX, className: 'text-danger' };
}

const RED_WORDS: Partial<Record<NonNullable<PullRequestCheck['conclusion']>, string>> = {
  cancelled: 'abgebrochen',
  timed_out: 'Zeitlimit',
  action_required: 'braucht eine Freigabe',
  stale: 'veraltet',
};

/** A finished check that holds the PR back: everything but success, skipped and neutral (spec 7.2). */
const isRed = (check: PullRequestCheck) => check.status === 'completed' && check.conclusion !== 'success' && check.conclusion !== 'skipped' && check.conclusion !== 'neutral';

/** CI of the head commit in words: red as soon as one check fails, green when all have passed (spec 7.2). */
export function ciOf(checks: readonly PullRequestCheck[]): { label: string; tone: 'neutral' | 'danger' | 'quiet' | 'accent' } {
  if (checks.length === 0) return { label: 'Keine Checks', tone: 'quiet' };
  if (checks.some(isRed)) return { label: 'CI rot', tone: 'danger' };
  if (checks.some((check) => check.status !== 'completed')) return { label: 'CI läuft', tone: 'accent' };
  return { label: 'CI grün', tone: 'neutral' };
}

function PullRequestRow({ pr }: { pr: PullRequestLink }) {
  const users = useUserMap();
  const state = stateOf(pr);
  const ci = ciOf(pr.checks);
  const author = pr.author.kind === 'agent' ? `${users.get(pr.author.bot_id)?.name ?? 'Agent'} (Agent)` : pr.author.login;
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
          <span className="sr-only">(öffnet GitHub)</span>
        </a>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <Badge tone={pr.state === 'open' && !pr.draft ? 'accent' : 'quiet'}>{state.label}</Badge>
          {pr.state === 'open' && !pr.draft && <Badge tone={ci.tone}>{ci.label}</Badge>}
          {pr.review &&
            (pr.review === 'approve' ? (
              // an agent's PR gets the verdict as a comment, a person's PR a GitHub review "Approve" (spec 7.2)
              <Badge icon={CircleCheck}>{pr.author.kind === 'agent' ? 'Review: ohne Befunde' : 'Review: Approve'}</Badge>
            ) : (
              <Badge tone="danger">Review: Befunde</Badge>
            ))}
          <span className="text-muted">von {author}</span>
          <span className="min-w-0 text-muted">
            <span translate="no" className="break-all">
              {pr.head_branch}
            </span>{' '}
            nach <span translate="no">{pr.base_branch}</span>
          </span>
          <span className="text-muted">{pr.closes ? 'schließt beim Merge' : 'nur verknüpft'}</span>
        </div>
        {pr.checks.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label={`Checks von #${pr.number}`}>
            {pr.checks.map((check) => {
              const look = checkOf(check);
              return (
                <li key={check.name} className="inline-flex items-center gap-1">
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
        {pr.draft && <p className="mt-1 text-sm text-pretty text-muted">Ein Entwurf löst nichts aus: Review und Status kommen, wenn der PR bereit ist.</p>}
      </div>
    </li>
  );
}

export function PullRequests({ item }: { item: WorkItem }) {
  const agents = useItemAgents(item.id);
  const settings = useProjectAgents(item.project_id);
  const prs = agents.data?.pull_requests ?? [];
  const repo = settings.data?.repo ?? null;
  if (prs.length === 0 && repo === null) return null;
  return (
    <Section title="Pull Requests" aside={prs.length > 0 ? String(prs.length) : undefined}>
      {prs.length === 0 ? (
        <p className="mt-1 max-w-[65ch] text-ui text-pretty text-muted">
          Noch kein PR. Ein PR in <span translate="no">{repo}</span> erscheint hier, sobald sein Titel, seine Beschreibung oder sein Branch {item.key} nennt; mit „Fixes {item.key}“ schließt sein Merge das Item.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-line" aria-label={`Pull Requests von ${item.key}`}>
          {prs.map((pr) => (
            <PullRequestRow key={pr.id} pr={pr} />
          ))}
        </ul>
      )}
    </Section>
  );
}
