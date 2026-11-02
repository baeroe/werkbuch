<?php

namespace App\Search;

use App\Events\EventConsumer;
use App\Events\EventType;
use App\Events\RetriesConsumption;
use App\Jobs\ReindexWorkItems;
use App\Models\Event;
use App\Models\Project;

/**
 * Keeps the search index in step with the events (queue `search`): the one writer of the index besides a rebuild. It
 * writes through SearchIndexer within the claim transaction (writing a document is idempotent, a retry writes it again)
 * and hands what touches many items to ReindexWorkItems, dispatched after the commit. Everything else passes (P21;
 * reactions and `bot.mentioned` change no text either): who may see a document is decided when the search asks (P2),
 * so members and visibility change nothing here. The events of the migrations count as any other: the default bot of
 * `…_000500` gets its document, the built-in catalog of `…_000710` passes.
 */
final class SearchConsumer implements EventConsumer, RetriesConsumption
{
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
        $id = $event->subject_id;

        match ($event->type) {
            EventType::WorkItemCreated, EventType::WorkItemUpdated, EventType::WorkItemStateChanged, EventType::WorkItemAssigned,
            EventType::WorkItemArchived, EventType::WorkItemRestored,
            // the events of a comment hang on its item (A227), whose document holds the text of the comments (A245)
            EventType::CommentCreated, EventType::CommentUpdated, EventType::CommentDeleted => $this->indexer->upsertItem($id),
            EventType::WorkItemDeleted => $this->indexer->removeItem($id),
            EventType::ProjectCreated, EventType::ProjectArchived, EventType::ProjectRestored => $this->indexer->upsertProject($id),
            EventType::ProjectUpdated => $this->projectUpdated($event),
            // the rows may be gone already (the purge runs in the queue `bulk`): the documents go by the project's id
            EventType::ProjectDeleted => $this->indexer->removeProject($id),
            EventType::UserCreated, EventType::UserUpdated, EventType::UserRoleChanged, EventType::UserDeactivated,
            EventType::UserReactivated, EventType::BotCreated => $this->indexer->upsertUser($id),
            // the category of a status can change without an event of the items in it
            EventType::WorkflowUpdated => $this->reindex($this->projectsWith($id)),
            // the label went from its items by cascade, without events of theirs
            EventType::LabelDeleted => $this->reindex(null),
            default => null,
        };
    }

    /** A new identifier changes the key of every item of the project. */
    private function projectUpdated(Event $event): void
    {
        $this->indexer->upsertProject($event->subject_id);

        if (isset($event->changes['identifier'])) {
            $this->reindex([$event->subject_id]);
        }
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
     * @param  list<string>|null  $projectIds  `null`: every item
     */
    private function reindex(?array $projectIds): void
    {
        if ($projectIds !== []) {
            ReindexWorkItems::dispatch($projectIds)->afterCommit();
        }
    }
}
