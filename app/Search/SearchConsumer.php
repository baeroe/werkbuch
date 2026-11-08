<?php

namespace App\Search;

use App\Events\EventConsumer;
use App\Events\EventType;
use App\Events\RetriesConsumption;
use App\Jobs\ReindexWorkItems;
use App\Models\Event;
use App\Models\Project;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Str;

/**
 * Keeps the search index in step with the events (queue `search`): the one writer of the index besides a rebuild, which
 * replays the events of its own run through the same rules at the end (replaySince()). It writes through SearchIndexer
 * within the claim transaction (writing a document is idempotent, a retry writes it again) and hands what touches many
 * items to ReindexWorkItems, dispatched after the commit. Everything else passes (P21; reactions and `bot.mentioned`
 * change no text either): who may see a document is decided when the search asks (P2), so members and visibility
 * change nothing here. The events of the migrations count as any other: the default bot of `…_000500` gets its
 * document, the built-in catalog of `…_000710` passes.
 */
final class SearchConsumer implements EventConsumer, RetriesConsumption
{
    /** The events read and written at a time by replaySince(). */
    public const BLOCK = 500;

    public function __construct(private readonly SearchIndexer $indexer) {}

    public function key(): string
    {
        return 'search';
    }

    public function queue(): string
    {
        return 'search';
    }

    /**
     * 8 tries with 7 pauses (the last pause repeats): about 3 h 20 min before the job ends in failed_jobs and reports
     * the event (P12).
     */
    public function tries(): int
    {
        return 8;
    }

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 60, 300, 900, 3600];
    }

    public function consume(Event $event): void
    {
        $this->apply($this->collect([$event]));
    }

    /**
     * Writes the index again for every event since `$since` (a rebuild that swapped its indexes in: what the consumer
     * wrote into the old index meanwhile is gone with it). Only the rules of consume(), never a claim: the rows are read
     * fresh, so writing a document twice does no harm. In blocks of BLOCK events, with one query (and its eager loads)
     * and at most two writes (written, removed) per kind of document and block, not per event.
     *
     * @return int the events read
     */
    public function replaySince(DateTimeInterface $since): int
    {
        $count = 0;

        Event::query()
            // event ids are ULIDs of the moment they were recorded: the first id of that moment bounds the scan
            ->where('id', '>=', strtolower(substr((string) Str::ulid($since), 0, 10)).str_repeat('0', 16))
            ->where('occurred_at', '>=', $since)
            ->chunkById(self::BLOCK, function (Collection $events) use (&$count): void {
                $this->apply($this->collect(array_values($events->all())));
                $count += $events->count();
            });

        return $count;
    }

    /**
     * What the events ask of the index: the documents to write again (a row that is gone or of a project being deleted
     * loses its document), the projects deleted, the items to reindex in a job.
     *
     * @param  list<Event>  $events
     * @return array{items: list<string>, pages: list<string>, projects: list<string>, deleted: list<string>, users: list<string>, reindex: list<array{0: list<string>|null, 1: list<string>|null}>}
     */
    private function collect(array $events): array
    {
        $plan = ['items' => [], 'pages' => [], 'projects' => [], 'deleted' => [], 'users' => [], 'reindex' => []];

        foreach ($events as $event) {
            $id = $event->subject_id;

            // a new identifier changes the key of every item of the project
            if ($event->type === EventType::ProjectUpdated && isset($event->changes['identifier'])) {
                $plan['reindex'][] = [[$id], null];
            }
            // the category of a status can change without an event of the items in it; only the saved workflow says so,
            // the old default that lost its mark (no `categories_changed`) changes no document
            if ($event->type === EventType::WorkflowUpdated && ($event->meta['categories_changed'] ?? false) === true) {
                $plan['reindex'][] = [$this->projectsWith($id), null];
            }

            match ($event->type) {
                EventType::WorkItemCreated, EventType::WorkItemUpdated, EventType::WorkItemStateChanged, EventType::WorkItemAssigned,
                EventType::WorkItemArchived, EventType::WorkItemRestored, EventType::WorkItemDeleted,
                // the events of a comment hang on its item (A227), whose document holds the text of the comments (A245)
                EventType::CommentCreated, EventType::CommentUpdated, EventType::CommentDeleted => $plan['items'][] = $id,
                // a move changes nothing the document holds today, but writing it again is cheap and keeps it in step
                EventType::PageCreated, EventType::PageUpdated, EventType::PageMoved => $plan['pages'][] = $id,
                // the root and every page below it went in one event
                EventType::PageDeleted => array_push($plan['pages'], ...$this->pageIds($event)),
                EventType::ProjectCreated, EventType::ProjectUpdated, EventType::ProjectArchived, EventType::ProjectRestored => $plan['projects'][] = $id,
                // the rows may be gone already (the purge runs in the queue `bulk`): the documents of the project, its
                // items and its pages go by the project's id
                EventType::ProjectDeleted => $plan['deleted'][] = $id,
                EventType::UserCreated, EventType::UserUpdated, EventType::UserRoleChanged, EventType::UserDeactivated,
                EventType::UserReactivated, EventType::BotCreated => $plan['users'][] = $id,
                // the label went from its items by cascade, without events of theirs: only the items that carried it
                EventType::LabelDeleted => $plan['reindex'][] = [null, $this->itemIds($event)],
                default => null,
            };
        }

        return $plan;
    }

    /**
     * Writes what collect() found: an item, page, project or account that is gone loses its document (the upserts read
     * fresh), a deleted project takes the documents of its items and pages along.
     *
     * @param  array{items: list<string>, pages: list<string>, projects: list<string>, deleted: list<string>, users: list<string>, reindex: list<array{0: list<string>|null, 1: list<string>|null}>}  $plan
     */
    private function apply(array $plan): void
    {
        $this->indexer->upsertItems($plan['items']);
        $this->indexer->upsertPages($plan['pages']);
        $this->indexer->upsertProjects($plan['projects']);
        foreach (array_unique($plan['deleted']) as $project) {
            $this->indexer->removeProject($project);
        }
        $this->indexer->upsertUsers($plan['users']);
        foreach ($plan['reindex'] as [$projectIds, $itemIds]) {
            $this->reindex($projectIds, $itemIds);
        }
    }

    /**
     * The pages a `page.deleted` removed (`meta.page_ids`, the root first), at least its root.
     *
     * @return list<string>
     */
    private function pageIds(Event $event): array
    {
        return array_values(array_filter((array) ($event->meta['page_ids'] ?? [$event->subject_id]), is_string(...)));
    }

    /**
     * The items a `label.deleted` took the label off (`meta.item_ids`).
     *
     * @return list<string>
     */
    private function itemIds(Event $event): array
    {
        return array_values(array_filter((array) ($event->meta['item_ids'] ?? []), is_string(...)));
    }

    /**
     * The projects that follow the workflow (a project being deleted too: the reindex leaves its items out, K11).
     *
     * @return list<string>
     */
    private function projectsWith(string $workflowId): array
    {
        /** @var list<string> */
        return Project::query()->where('workflow_id', $workflowId)->pluck('id')->all();
    }

    /**
     * @param  list<string>|null  $projectIds  `null`: every project
     * @param  list<string>|null  $itemIds  `null`: every item of those projects
     */
    private function reindex(?array $projectIds, ?array $itemIds = null): void
    {
        if ($projectIds !== [] && $itemIds !== []) {
            ReindexWorkItems::dispatch($projectIds, $itemIds)->afterCommit();
        }
    }
}
