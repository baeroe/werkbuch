<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\PageVersion;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\PageLock;
use App\Support\RichTextRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Restores a kept version of a page (`POST /api/v1/pages/{page}/versions/{pageVersion}/restore`, spec 4.15) as its
 * newest state: members and admins of the project (`wiki.edit`); a version of another page is the 404 of an unknown one.
 * The text of the version runs through the rules of saving before any lock, with itself as the text before (A323, K9):
 * its mentions and references stay, also those the restorer could not add; a picture or file that is gone meanwhile
 * leaves it without an error. Under PageLock::page (the project shared, the page `for update`): the version afresh (gone
 * → 404), then the stored state always kept as a version (no base needed, A309; a number kept already stays), then the
 * title and text of the version as version + 1 by the restorer (the emoji stays: versions keep none, A323), its uploads
 * linked to the page, and `page.updated` with the title when it changes and the version, `meta.restored_version` the
 * number restored; never the text (A306).
 */
final class RestorePageVersion
{
    use AsAction;

    /**
     * @throws Problem 404, 403 `wiki_members_only`, 409 `project_archived`
     * @throws ValidationException at `content_json`, only for an attachment the version names that is no longer usable
     */
    public function handle(Actor $actor, Page $page, PageVersion $version): Page
    {
        Authorize::check($actor, 'update', $page);
        if ($version->page_id !== $page->id) {
            throw Problem::notFound();
        }

        // the rules of saving read by ID and may take long: never under a lock
        $doc = $version->content === null ? null : Document::fromJson($version->content);
        $doc = $doc === null ? null : RichTextRules::apply($doc, $page->project, $actor->user, $doc, 'content_json');

        $page = DB::transaction(function () use ($actor, $page, $version, $doc): Page {
            $locked = PageLock::page($page);
            $restored = PageVersion::query()->where('page_id', $locked->id)->find($version->id) ?? throw Problem::notFound();

            UpdatePage::snapshot($locked);
            $changes = [];
            if ($restored->title !== $locked->title) {
                $changes['title'] = ['old' => $locked->title, 'new' => $restored->title];
            }
            $changes['version'] = ['old' => $locked->version, 'new' => $locked->version + 1];

            $locked->update([
                'title' => $restored->title,
                'content' => $doc?->toJson(),
                'content_text' => $doc?->toText(),
                'version' => $locked->version + 1,
                'updated_by' => $actor->user->id,
            ]);
            if ($doc !== null) {
                AttachmentLinks::link($locked, $locked->project, $actor->user, ['content_json' => $doc]);
            }

            EventRecorder::record(EventType::PageUpdated, $actor, $locked, $locked->project, $changes, ['restored_version' => $restored->version]);

            return $locked;
        }, 3);

        Page::loadForResource($page, $actor->user);

        return $page;
    }
}
