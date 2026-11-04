<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Domain\Wiki\PageTree;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Page;
use App\Support\Actor;
use App\Support\AttachmentTexts;
use App\Support\PageLock;
use App\Support\ReadCommitted;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Deletes a page with its whole subtree (`DELETE /api/v1/pages/{page}` → 200 `{deleted}`, spec 4.15): members and admins
 * of the project (`wiki.edit`). Under the tree lock (PageLock::tree: the project `for update`, gone or being deleted 404,
 * archived 409), so no page moves into the subtree or out of it meanwhile and every save of a page of the project waits:
 * - the page afresh (gone meanwhile: 404, no second event) and its subtree from the parent links (PageTree::subtree);
 * - the pages of the subtree `for update` in id order, then their attachments `for update` (over the morph index);
 * - the attachments another text of the project still shows (another page or one of its versions, a description, a
 *   comment) go over to that text, the rest go, their files after the commit (AttachmentTexts::handOverOrRemove with
 *   the subtree as `exceptPages`: its pages and versions go too and name nothing, K11; A233, A261);
 * - the tree of the subtree loosened (`parent_id` null) and its rows removed in one statement, the versions by cascade:
 *   no `set null` of a child depends on the order InnoDB removes the rows in, a tree of any depth goes (K1);
 * - one `page.deleted` with the root as subject, no `changes`, `meta.title` and `meta.page_ids` (the root first, then
 *   level by level, A310). The project keeps its `updated_at`.
 * The texts are read as they are now, after the lock on the attachments (ReadCommitted, N1). The transaction runs up
 * to three times (locking several page rows).
 */
final class DeletePage
{
    use AsAction;

    /**
     * @return int how many pages went
     *
     * @throws Problem
     */
    public function handle(Actor $actor, Page $page): int
    {
        Authorize::check($actor, 'update', $page);

        return ReadCommitted::run(fn () => DB::transaction(function () use ($actor, $page): int {
            $project = PageLock::tree($page->project);
            $root = Page::query()->where('project_id', $project->id)->find($page->id) ?? throw Problem::notFound();
            $ids = (new PageTree(PageLock::pages($project)->all()))->subtree($root->id);

            Page::query()->whereKey($ids)->orderBy('id')->lockForUpdate()->pluck('id');
            $attachments = Attachment::query()->where('attachable_type', $root->getMorphClass())->whereIn('attachable_id', $ids)
                ->orderBy('id')->lockForUpdate()->get();
            if ($attachments->isNotEmpty()) {
                AttachmentTexts::handOverOrRemove($attachments, $project->id, exceptPages: $ids);
            }

            Page::query()->whereKey($ids)->toBase()->update(['parent_id' => null]);
            Page::query()->whereKey($ids)->delete();

            EventRecorder::record(EventType::PageDeleted, $actor, $root, $project, null, ['title' => $root->title, 'page_ids' => $ids]);

            return count($ids);
        }, 3));
    }
}
