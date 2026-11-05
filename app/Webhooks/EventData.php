<?php

namespace App\Webhooks;

use App\Events\EventType;
use App\Http\Resources\CommentResource;
use App\Http\Resources\PageResource;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\TemplateResource;
use App\Http\Resources\TemplateRunResource;
use App\Http\Resources\UserResource;
use App\Http\Resources\WorkItemResource;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Page;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use LogicException;

/**
 * `data` of a webhook (plan "`data` je Ereignis", A362, A363): the subject of the event as REST reads it for one reader
 * (the bot of the webhook, else the default bot), through the resources with a request whose `user()` is the reader, so
 * `my_role`, `is_member`, `subscribed` and the hidden references of the Markdown are theirs. Deletions have a small
 * fixed form from `meta` (the subject is gone); a subject that is gone since, or one the reader does not see (any more),
 * is `null`. Every read goes through the `loadForResource` of its model: a fixed number of queries per event.
 */
final class EventData
{
    /**
     * @return array<string, mixed>|null
     */
    public static function of(Event $event, User $reader): ?array
    {
        $request = new Request;
        $request->setUserResolver(fn () => $reader);
        $meta = $event->meta;

        return match ($event->type) {
            EventType::ProjectDeleted => ['id' => $event->subject_id, 'identifier' => $meta['identifier'] ?? null, 'name' => $meta['name'] ?? null],
            EventType::WorkItemDeleted => ['id' => $event->subject_id, 'key' => $meta['key'] ?? null, 'title' => $meta['title'] ?? null],
            // no text: a deleted comment says nothing of what it said (A228)
            EventType::CommentDeleted => ['id' => $meta['comment_id'] ?? null, 'work_item_id' => $event->subject_id, 'author_id' => $meta['author_id'] ?? null],
            EventType::PageDeleted => ['id' => $event->subject_id, 'title' => $meta['title'] ?? null, 'page_ids' => $meta['page_ids'] ?? []],
            EventType::ProjectCreated, EventType::ProjectUpdated, EventType::ProjectArchived, EventType::ProjectRestored,
            EventType::ProjectMemberAdded, EventType::ProjectMemberRemoved => self::project($event->subject_id, $reader, $request),
            EventType::CommentCreated, EventType::CommentUpdated => self::comment($event, $reader, $request),
            EventType::PageCreated, EventType::PageUpdated, EventType::PageMoved => self::page($event->subject_id, $reader, $request),
            EventType::BotMentioned, EventType::BotAssigned => self::bot($event, $reader, $request),
            EventType::TemplateRunFailed => self::run($event, $reader, $request),
            EventType::WorkItemCreated, EventType::WorkItemUpdated, EventType::WorkItemStateChanged, EventType::WorkItemAssigned,
            EventType::WorkItemArchived, EventType::WorkItemRestored, EventType::WorkItemRelationAdded,
            EventType::WorkItemRelationRemoved => self::item($event->subject_id, $reader, $request),
            // a new event of the catalog needs a branch of its own (T5-M3); the others have no data
            default => $event->type->webhook() ? throw new LogicException("No webhook data for {$event->type->value}.") : null,
        };
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function project(string $id, User $reader, Request $request): ?array
    {
        $project = Project::query()->visibleTo($reader)->with(['media', 'types:work_item_types.id'])->find($id);

        return $project === null ? null : self::resolve(new ProjectResource($project), $request);
    }

    /**
     * The item in full (`work_item.*`), or lean as the item of a comment.
     *
     * @return array<string, mixed>|null
     */
    private static function item(string $id, User $reader, Request $request, bool $lean = false): ?array
    {
        $item = WorkItem::query()->visibleTo($reader)->find($id);
        if ($item === null) {
            return null;
        }
        WorkItem::loadForResource($item, $reader, $lean);

        return self::resolve(new WorkItemResource($item), $request);
    }

    /**
     * The comment of `meta.comment_id` (the subject is its item, A227) with its item lean.
     *
     * @return array<string, mixed>|null
     */
    private static function comment(Event $event, User $reader, Request $request): ?array
    {
        $comment = self::commentOf($event, $reader, $request);
        $item = $comment === null ? null : self::item($event->subject_id, $reader, $request, true);

        return $comment === null || $item === null ? null : [...$comment, 'work_item' => $item];
    }

    /**
     * The comment `meta.comment_id` names, as CommentResource, while it is there on an item the reader sees.
     *
     * @return array<string, mixed>|null
     */
    private static function commentOf(Event $event, User $reader, Request $request): ?array
    {
        $id = $event->meta['comment_id'] ?? null;
        $comment = is_string($id)
            ? Comment::query()->where('work_item_id', $event->subject_id)
                ->whereHas('workItem', fn ($items) => $items->visibleTo($reader))->find($id)
            : null;
        if ($comment === null) {
            return null;
        }
        Comment::loadForResource($comment, $reader);

        return self::resolve(new CommentResource($comment), $request);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function page(string $id, User $reader, Request $request): ?array
    {
        $page = Page::query()->visibleTo($reader)->find($id);
        if ($page === null) {
            return null;
        }
        Page::loadForResource($page, $reader);

        return self::resolve(new PageResource($page), $request);
    }

    /**
     * `bot.mentioned` (with where, `meta.source`, and the comment when it was one, while it is there) and `bot.assigned`:
     * the bot of `meta.bot_id` and the item (the subject).
     *
     * @return array<string, mixed>|null
     */
    private static function bot(Event $event, User $reader, Request $request): ?array
    {
        $id = $event->meta['bot_id'] ?? null;
        $bot = is_string($id) ? User::query()->with('media')->find($id) : null;
        $item = $bot === null ? null : self::item($event->subject_id, $reader, $request);
        if ($bot === null || $item === null) {
            return null;
        }

        $data = ['bot' => self::resolve(new UserResource($bot), $request), 'item' => $item];

        return $event->type === EventType::BotAssigned ? $data : [
            ...$data,
            'source' => $event->meta['source'] ?? null,
            'comment' => self::commentOf($event, $reader, $request),
        ];
    }

    /**
     * The failed run of `meta.run_id` (the subject is its template, K19) with its template lean.
     *
     * @return array<string, mixed>|null
     */
    private static function run(Event $event, User $reader, Request $request): ?array
    {
        $template = Template::query()->visibleTo($reader)->find($event->subject_id);
        $id = $event->meta['run_id'] ?? null;
        $run = $template === null || ! is_string($id) ? null : TemplateRun::query()->where('template_id', $template->id)->find($id);
        if ($template === null || $run === null) {
            return null;
        }
        Template::loadForResource($template, $reader, true);

        return [...self::resolve(new TemplateRunResource($run), $request), 'template' => self::resolve(new TemplateResource($template), $request)];
    }

    /**
     * The resource as an array for the reader of the request.
     *
     * @return array<string, mixed>
     */
    private static function resolve(JsonResource $resource, Request $request): array
    {
        return $resource->resolve($request);
    }
}
