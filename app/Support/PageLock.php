<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\Page;
use App\Models\Project;
use Illuminate\Support\Collection;

/**
 * The locks of a change of the wiki, in the order project → page(s) by id → attachments; never the organization (the
 * wiki reads no catalog). A change of the tree (create, move, delete) holds the project row `for update`, so one tree
 * change of a project runs at a time and sees every page; a change of one page (save, restore) holds the project shared
 * and the page `for update`, so it waits for a tree change and two saves of one page wait for each other. Callers stand
 * in their own transaction; what they check afterwards they check against the rows read here.
 */
final class PageLock
{
    /**
     * The project afresh and under `lockForUpdate`.
     *
     * @throws Problem 404 when it is gone or being deleted, 409 `project_archived` when it is archived
     */
    public static function tree(Project $project): Project
    {
        return self::writable(Project::query()->lockForUpdate()->find($project->id));
    }

    /**
     * The page afresh and under `lockForUpdate`, after its project afresh (shared, with the checks of tree()), which
     * it carries as `project`.
     *
     * @throws Problem 404 when the page or its project is gone or the project is being deleted, 409 `project_archived`
     */
    public static function page(Page $page): Page
    {
        $project = self::writable(Project::query()->sharedLock()->find($page->project_id));
        $locked = Page::query()->lockForUpdate()->find($page->id) ?? throw Problem::notFound();

        return $locked->setRelation('project', $project);
    }

    /**
     * The parent of every page of the project (id → parent id, null at the top), the siblings in their order, with one
     * query: the links PageTree works on. Only under tree(), which keeps the tree as it is read.
     *
     * @return Collection<string, ?string>
     */
    public static function pages(Project $project): Collection
    {
        return Page::query()->where('project_id', $project->id)->orderBy('rank')->orderBy('id')->toBase()
            ->get(['id', 'parent_id'])
            ->mapWithKeys(fn (object $row) => [(string) $row->id => $row->parent_id === null ? null : (string) $row->parent_id]);
    }

    /**
     * @throws Problem 404 or 409 `project_archived`
     */
    private static function writable(?Project $project): Project
    {
        if ($project === null || $project->deleting_at !== null) {
            throw Problem::notFound();
        }

        ItemLock::refuseArchivedProject($project);

        return $project;
    }
}
