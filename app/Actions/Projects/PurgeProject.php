<?php

namespace App\Actions\Projects;

use App\Access\Visibility;
use App\Models\Attachment;
use App\Models\Favorite;
use App\Models\Page;
use App\Models\Project;
use App\Support\Actor;
use App\Support\AttachmentFiles;
use Illuminate\Support\Facades\DB;
use LogicException;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Filesystem;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * Removes a project that DeleteProject marked (`deleting_at`), run by the job App\Jobs\PurgeProject: the roles in it
 * (spatie's rows of the team = project, which have no foreign key), favorites, memberships, former identifiers, its
 * media, the files of its attachments (also uploads nobody owns yet; AttachmentFiles, after the commit) and the project
 * itself. Its work items go with the project by cascade (`work_items.project_id`), and with them their values, labels,
 * subscriptions, comments and relations, also those to items of other projects, without an event at the other end
 * (A26); the attachment rows go by cascade too (`attachments.project_id`). Its wiki pages go by cascade as well
 * (`pages.project_id`), and with them their versions; their tree is loosened first (`parent_id` null), so a tree of any
 * depth goes and no `set null` of a child depends on which index InnoDB checks the key of the project on (K1, T2-M1).
 * Its events stay (P10). Later phases add their data here (templates).
 *
 * The one writing action without an event of its own: it only cleans up after `project.deleted` (P26).
 */
final class PurgeProject
{
    use AsAction;

    /**
     * @throws LogicException for a project that is not being deleted
     */
    public function handle(Actor $actor, Project $project): void
    {
        if ($project->deleting_at === null) {
            throw new LogicException("Project [{$project->id}] is not being deleted; only DeleteProject starts a purge.");
        }

        DB::transaction(function () use ($project): void {
            DB::table('model_has_roles')->where('team_id', $project->id)->delete();
            Favorite::query()->where('favoritable_type', $project->getMorphClass())->where('favoritable_id', $project->id)->delete();
            $project->memberships()->delete();
            $project->identifiers()->delete();

            // the rows go now, the files after the commit: a purge that fails keeps its files for the next attempt
            $media = $project->media()->get();
            $media->each(fn (Media $item) => $item->deleteQuietly());
            DB::afterCommit(fn () => $media->each(fn (Media $item) => app(Filesystem::class)->removeAllFiles($item)));

            // the media rows of the attachments would stay without an owner after the cascade (K12)
            AttachmentFiles::removeAfterCommit(Attachment::query()->where('project_id', $project->id)->select('id')->get());

            // the pages go by cascade, each by its project: without a parent first (K1)
            Page::query()->where('project_id', $project->id)->toBase()->update(['parent_id' => null]);

            $project->deletePreservingMedia();
        });

        Visibility::forget();
    }
}
