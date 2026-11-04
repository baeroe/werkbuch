<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Domain\Wiki\PageTree;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Page;
use App\Support\Actor;
use App\Support\Ids;
use App\Support\PageInput;
use App\Support\PageLock;
use App\Support\PageRanks;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Moves a page in the tree of its wiki (`POST /api/v1/pages/{page}/move`, spec 4.15): members and admins of the project
 * (`wiki.edit`). `parent_id` (`null`: the top level) and `before_id` (the sibling to stand in front of, `null`: at the
 * end) are both required keys, ULIDs in any case. Under the tree lock (PageLock::tree: the project `for update`, gone
 * or being deleted 404, archived 409), so one tree change of a project runs at a time and the check for a cycle sees
 * the tree as the move leaves it:
 * - the page afresh (`for update`, gone 404) and the parent links of the project (PageLock::pages);
 * - the parent: a page of the same project (else `field.parent_page.unknown`, K8: PageTree::wouldCycle knows no
 *   unknown page), never the page itself or a page below it (`field.parent_page.cycle`), both at `parent_id`;
 * - the same place (same parent, same sibling after it): nothing, no event;
 * - the rank from the neighbours (PageRanks::between: `field.before_id.sibling`, new ranks for the row when there is no
 *   room, A320); the page takes its subtree along.
 * A move is no save: version, `updated_at` and `updated_by` stay, so an open editor keeps its base version.
 * `page.moved` names both `parent_id` and `rank` as `{old, new}` (the place of the page, also when only one changes).
 */
final class MovePage
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `parent_id`, `before_id`
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Page $page, array $input): Page
    {
        Authorize::check($actor, 'update', $page);

        $missing = array_values(array_filter(['parent_id', 'before_id'], fn (string $key) => ! array_key_exists($key, $input)));
        if ($missing !== []) {
            throw ValidationException::withMessages(array_fill_keys($missing, [__('field.required')]));
        }
        $beforeId = Ids::normalize($input['before_id']);

        $page = DB::transaction(function () use ($actor, $page, $input, $beforeId): Page {
            $project = PageLock::tree($page->project);
            $locked = Page::query()->where('project_id', $project->id)->lockForUpdate()->find($page->id) ?? throw Problem::notFound();
            $parents = PageLock::pages($project);

            $errors = [];
            $parent = PageInput::parent($input, $project, $errors);
            if ($parent !== null && (new PageTree($parents->all()))->wouldCycle($locked->id, $parent->id)) {
                $errors['parent_id'] = [__('field.parent_page.cycle')];
            }
            if ($beforeId !== null && ! is_string($beforeId)) {
                $errors['before_id'] = [__('field.before_id.sibling')];
            }
            PageInput::refuse($errors);
            $parentId = $parent?->id;
            $before = is_string($beforeId) ? $beforeId : null;

            if ($parentId === $locked->parent_id && $before === self::nextSibling($parents->all(), $locked)) {
                return $locked;
            }

            $old = ['parent_id' => $locked->parent_id, 'rank' => $locked->rank];
            $locked->parent_id = $parentId;
            $locked->rank = PageRanks::between($project, $parentId, $before, $locked->id);
            // no save: neither the version nor who saved it last nor when
            $locked->timestamps = false;
            $locked->saveQuietly();
            $locked->timestamps = true;

            EventRecorder::record(EventType::PageMoved, $actor, $locked, $project, [
                'parent_id' => ['old' => $old['parent_id'], 'new' => $locked->parent_id],
                'rank' => ['old' => $old['rank'], 'new' => $locked->rank],
            ]);

            return $locked;
        }, 3);

        Page::loadForResource($page, $actor->user);

        return $page;
    }

    /**
     * The sibling right after the page in its row (`null`: it is the last).
     *
     * @param  array<string, ?string>  $parents  page id => parent id, the siblings in their order (PageLock::pages)
     */
    private static function nextSibling(array $parents, Page $page): ?string
    {
        $row = array_keys(array_filter($parents, fn (?string $parent) => $parent === $page->parent_id));
        $index = array_search($page->id, $row, true);

        return $index === false ? null : ($row[$index + 1] ?? null);
    }
}
