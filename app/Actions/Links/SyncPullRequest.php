<?php

namespace App\Actions\Links;

use App\Actions\Comments\AddComment;
use App\Actions\WorkItems\TransitionWorkItem;
use App\Domain\GitHub\KeywordHit;
use App\Domain\GitHub\LinkKeywords;
use App\Domain\Workflow\AgentStep;
use App\Domain\Workflow\StateCategory;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Jobs\PostPullRequestComment;
use App\Models\AgentProjectSettings;
use App\Models\Event;
use App\Models\Project;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;
use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use App\Support\Actor;
use App\Support\AgentPullRequests;
use App\Support\CatalogLock;
use App\Support\ItemLock;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;
use RuntimeException;

/**
 * Links a PR of the repo of a project to its items (spec 12) from a `pull_request` delivery, on every action: title and
 * body (outside of code) and the head branch name the items (LinkKeywords, keys of the project and its former
 * identifiers); a link per item holds the PR as GitHub told it last. `skip` takes a link back, a key that is gone
 * otherwise leaves its link (like a relation). Events at the item: `work_item.link_added`, `work_item.link_merged`,
 * `work_item.link_removed`.
 *
 * What a PR of a person sets off, when the workflow of the project names every step of the agents (spec 7.4, else it
 * only links): a PR that is open and ready (opened, out of draft, reopened, or a ready PR that names a new item) moves
 * each of its items in a Backlog or Unstarted state to „In Review“; a draft sets off nothing. A PR merged into the base
 * branch of the project moves the items it closes to „Gemergt“, unless another PR (a draft too) is still open at the
 * item; closed items stay. A move the workflow does not allow leaves the state and says so in a comment at the item. The
 * moves are the default bot's (`Actor::automation('pr_link')`, A543). An archived item or project moves nothing. A PR
 * closed without a merge lets an item it was holding back go to „Gemergt“ when another PR merged and closed it before
 * and no person changed its state since.
 *
 * Order (A550): GitHub sends out of order and again; a delivery whose `updated_at` is older than what the links of the
 * PR hold writes no field (it only names items, a new link takes the PR as the newest delivery told it), and a merged
 * PR stays merged; it names items, but neither takes a link back (`skip`) nor makes one close. Only links to items of the project the repo belongs to now count: a former project keeps its links
 * untouched.
 *
 * PRs of agents (AgentPullRequests: the app opened them, or a strand has them) are linked as any other, with their
 * strand; what they set off is the flow's (WEBU-26), which takes them where this answers `agent`. The comment at a PR of
 * a person comes after the commit (PostPullRequestComment), unless the project switched it off (`comment_on_pr`, A547). Locks: the organization and the project shared, the repo
 * row of the project (one delivery of the repo at a time), the items in order of their ID, then the links of the PR.
 * Answers `ignored` (not a PR of a project's repo), `linked` or `agent`.
 */
final class SyncPullRequest
{
    use AsAction;

    /** The reason of the moves and comments (`meta.reason`, the history says „Pull request“). */
    public const REASON = 'pr_link';

    /**
     * @param  array<array-key, mixed>  $payload  the payload of a `pull_request` delivery
     */
    public function handle(Actor $actor, array $payload): string
    {
        $pr = self::read($payload);
        $link = $pr === null ? null : ProjectRepository::query()->with('project.identifiers')
            ->whereHas('repository', fn ($query) => $query->where('github_id', $pr['repository_github_id']))->first();

        if ($pr === null || $link === null) {
            return 'ignored';
        }

        /** @var list<string> $identifiers */
        $identifiers = [$link->project->identifier, ...$link->project->identifiers->pluck('identifier')->all()];
        $hits = LinkKeywords::parse($pr['title']."\n\n".$pr['body'], $pr['head_branch'], $identifiers);
        $thread = AgentPullRequests::threadOf($link->project_id, $pr['repository_github_id'], $pr['number'], $pr['head_branch']);
        $agent = AgentPullRequests::isAgent($thread, $pr['author'], $pr['repository_github_id']);
        $pr['thread_id'] = $thread?->id;

        $refused = DB::transaction(fn () => self::write($actor, $link, $pr, $hits, $agent), 3);

        if ($refused === null) {
            return 'ignored';
        }

        foreach ($refused as $refusal) {
            self::comment($refusal, $pr);
        }

        return $agent ? 'agent' : 'linked';
    }

    /**
     * @param  array{repository_github_id: int, repository: string, number: int, title: string, body: string, url: string, state: string, draft: bool, head_branch: string, base_branch: string, head_sha: string, author: string, merged_at: ?Carbon, closed_at: ?Carbon, pr_updated_at: ?Carbon, thread_id: ?string}  $pr
     * @param  list<KeywordHit>  $hits
     * @return list<array{item: WorkItem, from: string, to: string}>|null the moves the workflow refused, null for a project that is gone
     */
    private static function write(Actor $actor, ProjectRepository $link, array $pr, array $hits, bool $agent): ?array
    {
        CatalogLock::share();
        $project = Project::query()->sharedLock()->find($link->project_id);
        $repo = ProjectRepository::query()->lockForUpdate()->find($link->id);

        // under the lock again: the project may be in deletion, the repo may belong to another project now
        if ($project === null || $project->deleting_at !== null || $repo === null || $repo->project_id !== $project->id) {
            return null;
        }

        $numbers = array_map(fn (KeywordHit $hit) => $hit->number, $hits);
        $kinds = array_combine($numbers, array_map(fn (KeywordHit $hit) => $hit->kind, $hits));
        $named = WorkItem::query()->where('project_id', $project->id)->whereIn('number', $numbers)->pluck('id', 'number')->all();
        // only links to items of this project: the repo may have belonged to another project before, whose links stay
        // as they are and never move with this one (nor show in its comment)
        $ofProject = WorkItem::query()->select('id')->where('project_id', $project->id);
        $linked = WorkItemLink::query()->where('repository_github_id', $pr['repository_github_id'])->where('number', $pr['number'])
            ->whereIn('work_item_id', $ofProject)->pluck('work_item_id')->all();

        // the items first, in the order of their IDs, as every change of an item locks them; then the links of the PR
        $items = WorkItem::query()->whereKey(array_unique([...array_values($named), ...$linked]))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $links = WorkItemLink::query()->where('repository_github_id', $pr['repository_github_id'])->where('number', $pr['number'])
            ->whereIn('work_item_id', $items->modelKeys())->lockForUpdate()->get()->keyBy('work_item_id');
        $kindOf = [];
        foreach ($named as $number => $itemId) {
            $kindOf[$itemId] = $kinds[$number];
        }

        // a delivery older than what the links hold (GitHub sends out of order, and again) writes no field: it only
        // names items; a new link then takes the PR as the newest delivery told it. Merged is the end of a PR.
        $newest = $links->sortByDesc(fn (WorkItemLink $link) => $link->pr_updated_at?->getTimestamp() ?? 0)->first();
        $stale = $newest?->pr_updated_at !== null && $pr['pr_updated_at'] !== null && $pr['pr_updated_at']->lt($newest->pr_updated_at);
        $fields = $stale ? self::fieldsOf($newest) : [...array_diff_key($pr, ['body' => true]), 'kind' => WorkItemLink::PULL_REQUEST];
        $events = $actor->withReason(self::REASON);
        $review = [];
        $merged = [];
        $released = [];
        $changed = false;

        foreach ($items as $item) {
            // an old delivery still names items, but decides nothing: it neither takes a link back nor makes one close
            $kind = $stale && isset($kindOf[$item->id]) ? KeywordHit::LINKS : $kindOf[$item->id] ?? null;
            $existing = $links->get($item->id);

            if ($kind === KeywordHit::SKIP) {
                if ($existing !== null) {
                    $existing->delete();
                    EventRecorder::record(EventType::WorkItemLinkRemoved, $events, $item, $project, ['pull_request' => ['old' => self::snapshot($existing), 'new' => null]]);
                    $changed = true;
                }

                continue;
            }

            if ($existing === null) {
                $added = WorkItemLink::query()->create([...$fields, 'work_item_id' => $item->id, 'closes' => $kind === KeywordHit::CLOSES, 'head_seen_at' => $fields['head_seen_at'] ?? now(),
                    'merged_seen_at' => $fields['merged_seen_at'] ?? (($fields['state'] ?? null) === WorkItemLink::MERGED ? now() : null)]);
                EventRecorder::record(EventType::WorkItemLinkAdded, $events, $item, $project, ['pull_request' => ['old' => null, 'new' => self::snapshot($added)]]);
                $changed = true;
                $review[$item->id] = $added->active();
                $merged[$item->id] = $added->state === WorkItemLink::MERGED && $added->closes && $added->base_branch === $repo->base_branch;

                continue;
            }

            $before = self::snapshot($existing);
            $wasActive = $existing->active();
            $wasOpen = $existing->open();
            $wasMerged = $existing->state === WorkItemLink::MERGED;
            $closes = $kind === null || $stale ? $existing->closes : $kind === KeywordHit::CLOSES;
            $changed = $changed || $closes !== $existing->closes;

            if (! $stale && $existing->head_sha !== $pr['head_sha']) {
                // a push: the checks of the commit before no longer say anything about the PR
                WorkItemLinkCheck::query()->where('work_item_link_id', $existing->id)->delete();
                $existing->head_seen_at = now();
            }

            // a merged PR stays merged, whatever a later delivery says of its state
            $kept = $wasMerged ? $existing->only(['state', 'draft', 'merged_at', 'closed_at']) : [];
            $existing->fill([...($stale ? [] : $fields), ...$kept, 'closes' => $closes]);
            // when werkbuch learned of the merge: what a later move of a person at the item is compared with
            $existing->merged_seen_at = ! $wasMerged && $existing->state === WorkItemLink::MERGED ? now() : $existing->merged_seen_at;
            $existing->save();
            $review[$item->id] = ! $wasActive && $existing->active();
            $merged[$item->id] = ! $wasMerged && $existing->state === WorkItemLink::MERGED && $existing->closes && $existing->base_branch === $repo->base_branch;
            // closed without a merge: a PR merged before may now merge the item it closes (no other PR open any more)
            $released[$item->id] = $wasOpen && $existing->state === WorkItemLink::CLOSED;

            if (! $wasMerged && $existing->state === WorkItemLink::MERGED) {
                EventRecorder::record(EventType::WorkItemLinkMerged, $events, $item, $project, ['pull_request' => ['old' => $before, 'new' => self::snapshot($existing)]]);
            }
        }

        if (! $agent && $changed && AgentProjectSettings::of($project->id)->comment_on_pr) {
            PostPullRequestComment::dispatch($pr['repository_github_id'], $pr['number'])->afterCommit();
        }

        $workflow = Workflow::query()->with(['states', 'transitions'])->find($project->workflow_id);
        if ($agent || $project->archived_at !== null || $workflow === null || ! $workflow->agentStepsComplete()) {
            return [];
        }

        foreach ($items as $item) {
            $merged[$item->id] = ($merged[$item->id] ?? false) || (($released[$item->id] ?? false) && self::releases($item, $repo->base_branch));
        }

        $refused = [];
        $mover = Actor::automation(self::REASON);
        foreach ($items as $item) {
            $step = match (true) {
                $merged[$item->id] => AgentStep::Merged,
                $review[$item->id] ?? false => AgentStep::Review,
                default => null,
            };
            $refusal = $step === null ? null : self::move($mover, $item, $workflow, $step, $pr);

            if ($refusal !== null) {
                $refused[] = $refusal;
            }
        }

        return $refused;
    }

    /**
     * Moves an item to the state of a step when its state allows it: to review from Backlog or Unstarted, to merged
     * from any open state when no other PR is open at the item.
     *
     * @param  array{repository_github_id: int, number: int}  $pr
     * @return array{item: WorkItem, from: string, to: string}|null a move the workflow refused
     */
    private static function move(Actor $mover, WorkItem $item, Workflow $workflow, AgentStep $step, array $pr): ?array
    {
        $locked = ItemLock::take($item);
        $states = $workflow->states->keyBy('id');
        /** @var WorkflowState $from */
        $from = $states[$locked->state_id];
        /** @var WorkflowState $to */
        $to = $states[$workflow->agentState($step)];
        $otherOpen = WorkItemLink::query()->where('work_item_id', $locked->id)->where('state', WorkItemLink::OPEN)
            ->where(fn ($query) => $query->where('repository_github_id', '!=', $pr['repository_github_id'])->orWhere('number', '!=', $pr['number']))->exists();

        $moves = $step === AgentStep::Review
            ? in_array($from->category, [StateCategory::Backlog, StateCategory::Unstarted], true)
            : ! $from->category->isClosed() && ! $otherOpen;

        if (! $moves || $locked->archived_at !== null) {
            return null;
        }

        try {
            TransitionWorkItem::move($mover, $locked, $to->id, null);
        } catch (Problem) {
            return ['item' => $locked, 'from' => $from->name, 'to' => $to->name];
        }

        return null;
    }

    /**
     * Says at the item that the workflow did not allow the move, in the language of the organization. A comment that
     * cannot be written (item archived or gone meanwhile) is reported; the link holds anyway.
     *
     * @param  array{item: WorkItem, from: string, to: string}  $refusal
     * @param  array{repository: string, number: int, url: string}  $pr
     */
    private static function comment(array $refusal, array $pr): void
    {
        $locale = Locale::default()->value;
        $body = __('github.links.not_moved', [
            'pr' => "[{$pr['repository']}#{$pr['number']}]({$pr['url']})", 'from' => $refusal['from'], 'to' => $refusal['to'],
        ], $locale);

        try {
            AddComment::run(Actor::automation(self::REASON), $refusal['item'], ['body' => $body]);
        } catch (Problem|ValidationException|ModelNotFoundException $e) {
            report(new RuntimeException("A PR link could not comment at item {$refusal['item']->id}.", 0, $e));
        }
    }

    /**
     * Whether a PR that closed without a merge lets its item go to „Gemergt“: another PR merged into the base branch
     * and closed it before, and no person changed the state of the item since werkbuch learned of that merge (a person
     * who moved it on decided; A543).
     */
    private static function releases(WorkItem $item, string $baseBranch): bool
    {
        $since = WorkItemLink::query()->where('work_item_id', $item->id)->where('state', WorkItemLink::MERGED)->where('closes', true)
            ->where('base_branch', $baseBranch)->max('merged_seen_at');

        return $since !== null && ! Event::query()->where('subject_type', $item->getMorphClass())->where('subject_id', $item->id)
            ->where('type', EventType::WorkItemStateChanged->value)->where('occurred_at', '>=', $since)
            ->whereIn('actor_id', User::query()->select('id')->where('type', 'person'))->exists();
    }

    /**
     * The fields of the PR as a link holds them: what a new link of a delivery older than the links takes.
     *
     * @return array<string, mixed>
     */
    private static function fieldsOf(WorkItemLink $link): array
    {
        return $link->only(['kind', 'repository_github_id', 'repository', 'number', 'title', 'url', 'state', 'draft', 'head_branch', 'base_branch', 'head_sha', 'head_seen_at', 'author', 'thread_id', 'merged_at', 'closed_at', 'pr_updated_at', 'merged_seen_at']);
    }

    /**
     * What an event tells of a link.
     *
     * @return array{repository: string, number: int, title: string, url: string, state: string, draft: bool, closes: bool}
     */
    private static function snapshot(WorkItemLink $link): array
    {
        return [
            'repository' => $link->repository, 'number' => $link->number, 'title' => $link->title, 'url' => $link->url,
            'state' => $link->state, 'draft' => $link->draft, 'closes' => $link->closes,
        ];
    }

    /**
     * The PR of a delivery as a link holds it, null for a payload that is not one.
     *
     * @param  array<array-key, mixed>  $payload
     * @return array{repository_github_id: int, repository: string, number: int, title: string, body: string, url: string, state: string, draft: bool, head_branch: string, base_branch: string, head_sha: string, author: string, merged_at: ?Carbon, closed_at: ?Carbon, pr_updated_at: ?Carbon}|null
     */
    private static function read(array $payload): ?array
    {
        $pr = is_array($payload['pull_request'] ?? null) ? $payload['pull_request'] : [];
        $repository = is_array($payload['repository'] ?? null) ? $payload['repository'] : [];
        $head = is_array($pr['head'] ?? null) ? $pr['head'] : [];
        $base = is_array($pr['base'] ?? null) ? $pr['base'] : [];
        $user = is_array($pr['user'] ?? null) ? $pr['user'] : [];

        if (! is_int($repository['id'] ?? null) || ! is_string($repository['full_name'] ?? null) || ! is_int($pr['number'] ?? null)
            || ! is_string($head['ref'] ?? null) || ! is_string($head['sha'] ?? null) || preg_match('/^[0-9a-f]{40}\z/', $head['sha']) !== 1
            || ! is_string($base['ref'] ?? null) || ! is_string($pr['html_url'] ?? null)) {
            return null;
        }

        $merged = ($pr['merged'] ?? false) === true || is_string($pr['merged_at'] ?? null);
        $stamp = fn (mixed $value) => is_string($value) ? Carbon::parse($value) : null;

        return [
            'repository_github_id' => $repository['id'],
            'repository' => mb_substr($repository['full_name'], 0, 200),
            'number' => $pr['number'],
            'title' => mb_substr(is_string($pr['title'] ?? null) ? $pr['title'] : '', 0, 512),
            'body' => is_string($pr['body'] ?? null) ? $pr['body'] : '',
            'url' => mb_substr($pr['html_url'], 0, 2048),
            'state' => ($pr['state'] ?? null) === 'open' ? WorkItemLink::OPEN : ($merged ? WorkItemLink::MERGED : WorkItemLink::CLOSED),
            'draft' => ($pr['draft'] ?? false) === true,
            'head_branch' => mb_substr($head['ref'], 0, 255),
            'base_branch' => mb_substr($base['ref'], 0, 255),
            'head_sha' => $head['sha'],
            'author' => mb_substr(is_string($user['login'] ?? null) ? $user['login'] : '', 0, 100),
            'merged_at' => $merged ? $stamp($pr['merged_at'] ?? null) : null,
            'closed_at' => $stamp($pr['closed_at'] ?? null),
            'pr_updated_at' => $stamp($pr['updated_at'] ?? null),
        ];
    }
}
