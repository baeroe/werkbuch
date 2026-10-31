<?php

namespace App\Actions\Projects;

use App\Access\Visibility;
use App\Models\Favorite;
use App\Models\Project;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use LogicException;
use Lorisleiva\Actions\Concerns\AsAction;
use Spatie\MediaLibrary\MediaCollections\Filesystem;
use Spatie\MediaLibrary\MediaCollections\Models\Media;

/**
 * Removes a project that DeleteProject marked (`deleting_at`), run by the job App\Jobs\PurgeProject: the roles in it
 * (spatie's rows of the team = project, which have no foreign key), favorites, memberships, former identifiers, its
 * media and the project itself. Its events stay (P10). Later phases add their data here (items, pages, attachments).
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

            $project->deletePreservingMedia();
        });

        Visibility::forget();
    }
}
