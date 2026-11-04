<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Domain\Wiki\VersionRule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Http\Resources\PageResource;
use App\Models\Page;
use App\Models\PageVersion;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\PageInput;
use App\Support\PageLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Saves a page (`PATCH /api/v1/pages/{page}`, spec 4.15, plan „Versionen und Konflikt“): members and admins of the
 * project (`wiki.edit`); only the keys the input sends change. The text is read before any lock, with the stored one as
 * the text before (a mention or reference it had stays, A229). Under PageLock::page (the project shared, the page
 * `for update`), so two saves of one page wait for each other:
 * - nothing changes (title, emoji, JSON as stored): the page as it is, no event, the version stays, also on an outdated
 *   base (K17: the client takes the version of the answer as its base);
 * - `base_version` sent and not the version of the page: 409 `page_conflict` with the page as it is now for the writer
 *   (`current`) and the name of whoever saved it last; nothing written (A308: without `base_version` the save goes);
 * - VersionRule: before a foreign state, a state that rested ten minutes or when the writer asks (`keep_current`, A307),
 *   the stored state stays as a version (its number, title, text, author and time; an existing one stays);
 * - then the new state as version + 1 by the writer, its uploads linked to the page (AttachmentLinks), and
 *   `page.updated` with the title, the emoji and the version, never the text (A306), `meta.kept_version` when a
 *   state was kept.
 */
final class UpdatePage
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `title`, `emoji`, `content` (Markdown) or `content_json` (Tiptap JSON), `base_version`, `keep_current`
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Page $page, array $input): Page
    {
        Authorize::check($actor, 'update', $page);

        // reading Markdown is the expensive step: never under a lock
        $errors = [];
        $title = array_key_exists('title', $input) ? PageInput::title($input, $errors) : null;
        $emoji = PageInput::emoji($input, $errors);
        $before = $page->content === null ? null : Document::fromJson($page->content);
        $text = PageInput::content($input, $page->project, $actor->user, $before, $errors);
        $base = PageInput::baseVersion($input, $errors);
        $keep = PageInput::keepCurrent($input, $errors);
        PageInput::refuse($errors);

        $page = DB::transaction(function () use ($actor, $page, $input, $title, $emoji, $text, $base, $keep): Page {
            $locked = PageLock::page($page);

            $after = [
                'title' => $title ?? $locked->title,
                'emoji' => array_key_exists('emoji', $input) ? $emoji : $locked->emoji,
                'content' => $text === null ? $locked->content : $text[0]?->toJson(),
            ];
            $changed = $after['title'] !== $locked->title || $after['emoji'] !== $locked->emoji
                || json_encode($after['content']) !== json_encode($locked->content);
            if (! $changed) {
                return $locked;
            }
            if ($base !== null && $base !== $locked->version) {
                throw self::conflict($actor, $locked);
            }

            $kept = self::keep($actor, $locked, $keep);
            $changes = [];
            foreach (['title', 'emoji'] as $field) {
                if ($after[$field] !== $locked->{$field}) {
                    $changes[$field] = ['old' => $locked->{$field}, 'new' => $after[$field]];
                }
            }
            $changes['version'] = ['old' => $locked->version, 'new' => $locked->version + 1];

            $locked->update([
                ...$after,
                'content_text' => $text === null ? $locked->content_text : $text[0]?->toText(),
                'version' => $locked->version + 1,
                'updated_by' => $actor->user->id,
            ]);
            if ($text !== null && $text[0] !== null) {
                AttachmentLinks::link($locked, $locked->project, $actor->user, [$text[1] => $text[0]]);
            }

            EventRecorder::record(EventType::PageUpdated, $actor, $locked, $locked->project, $changes, $kept === null ? [] : ['kept_version' => $kept]);

            return $locked;
        }, 3);

        Page::loadForResource($page, $actor->user);

        return $page;
    }

    /**
     * Keeps the stored state as a version when VersionRule says so (`insertOrIgnore`: a number kept already stays as
     * it is) and gives its number, else `null`.
     */
    private static function keep(Actor $actor, Page $locked, bool $asked): ?int
    {
        $savedAt = $locked->updated_at?->getTimestamp() ?? 0;
        if (! VersionRule::keepBefore($actor->user->id, $locked->updated_by, $savedAt, now()->getTimestamp(), $asked)) {
            return null;
        }

        PageVersion::query()->insertOrIgnore([
            'id' => strtolower((string) Str::ulid()),
            'page_id' => $locked->id,
            'version' => $locked->version,
            'title' => $locked->title,
            // the stored JSON and time as they are, not read back through the casts
            'content' => $locked->getRawOriginal('content'),
            'author_id' => $locked->updated_by,
            'created_at' => $locked->getRawOriginal('updated_at'),
        ]);

        return $locked->version;
    }

    /**
     * The 409 of a save on an outdated version: the page as it is now, for the writer who sent the save (K5), and the
     * name of whoever saved it last.
     */
    private static function conflict(Actor $actor, Page $locked): Problem
    {
        Page::loadForResource($locked, $actor->user);

        return Problem::conflict(
            'page_conflict',
            ['current' => (new PageResource($locked))->resolve()],
            __('problem.detail.page_conflict', ['name' => $locked->editor->name]),
        );
    }
}
