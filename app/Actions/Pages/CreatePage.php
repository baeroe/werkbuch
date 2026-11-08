<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\Project;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\PageInput;
use App\Support\PageItemReferences;
use App\Support\PageLock;
use App\Support\PageRanks;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a page in the wiki of a project (`POST /api/v1/projects/{project}/pages`, spec 4.15): members and admins of
 * the project (`wiki.edit`). Title, emoji and text are read before any lock (the text through the rules of saving, it
 * may take a second); then the tree lock (PageLock::tree: the project `for update`, gone or being deleted 404, archived
 * 409), under it the parent (a page of the same project, else `field.parent_page.unknown`: a parent elsewhere would drop
 * the page out of the tree) and the rank after the last sibling. All field errors come in one 422. The page starts in
 * version 1 by the writer; the writer's uploads its text names become the page's (AttachmentLinks) and the items it
 * references are recorded (PageItemReferences). `page.created` with the title. The project comes as a model or a
 * reference (ULID, identifier or a former identifier).
 */
final class CreatePage
{
    use AsAction;

    /** The keys the body reads (`content` or `content_json`, not both); others are passed over. */
    public const FIELDS = ['title', 'emoji', 'parent_id', 'content', 'content_json'];

    /**
     * @param  array<array-key, mixed>  $input  `title`, `emoji`, `parent_id`, `content` (Markdown) or `content_json` (Tiptap JSON)
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Project|string $project, array $input): Page
    {
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;
        Authorize::check($actor, 'create', Page::class, $project);

        // reading Markdown is the expensive step: never under a lock
        $errors = [];
        $title = PageInput::title($input, $errors);
        $emoji = PageInput::emoji($input, $errors);
        [$content, $key] = PageInput::content($input, $project, $actor->user, null, $errors) ?? [null, 'content'];

        $page = DB::transaction(function () use ($actor, $project, $input, $errors, $title, $emoji, $content, $key): Page {
            $locked = PageLock::tree($project);
            $parent = PageInput::parent($input, $locked, $errors);
            PageInput::refuse($errors);

            $page = Page::query()->create([
                'project_id' => $locked->id,
                'parent_id' => $parent?->id,
                'rank' => PageRanks::append($locked, $parent?->id),
                'title' => $title,
                'emoji' => $emoji,
                'content' => $content?->toJson(),
                'content_text' => $content?->toText(),
                'version' => 1,
                'created_by' => $actor->user->id,
                'updated_by' => $actor->user->id,
            ]);
            if ($content !== null) {
                AttachmentLinks::link($page, $locked, $actor->user, [$key => $content]);
                PageItemReferences::sync($page, $content);
            }

            EventRecorder::record(EventType::PageCreated, $actor, $page, $locked, ['title' => ['old' => null, 'new' => $title]]);

            return $page;
        }, 3);

        Page::loadForResource($page, $actor->user);

        return $page;
    }
}
