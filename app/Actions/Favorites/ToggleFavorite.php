<?php

namespace App\Actions\Favorites;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Puts a project into the sidebar of the account, or takes it out again, and answers the new state. Only projects for
 * now: views come with Phase 5, so any other `kind` is a 422. A project the account does not see does not exist (404).
 * The account's own row is locked, so two toggles at the same time give consecutive positions and never a server error;
 * the project is read again under a shared lock, so a deletion at the same time leaves no favorite behind.
 * The events (`favorite.added`, `favorite.removed`) are personal: the project is their subject, but no project activity.
 */
final class ToggleFavorite
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input  `kind`, `id`
     * @return array{kind: string, id: string, favorite: bool}
     *
     * @throws ValidationException
     * @throws Problem 404
     */
    public function handle(Actor $actor, array $input): array
    {
        $valid = Validator::make($input, [
            'kind' => ['required', 'string', Rule::in(['project'])],
            'id' => ['required', 'string'],
        ], [
            'kind.required' => __('field.kind.unknown'),
            'kind.string' => __('field.kind.unknown'),
            'kind.in' => __('field.kind.unknown'),
            'id.required' => __('field.id.invalid'),
            'id.string' => __('field.id.invalid'),
        ])->validate();

        $project = Project::query()->find(strtolower($valid['id'])) ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $project);

        $favorite = DB::transaction(function () use ($actor, $project): bool {
            User::query()->lockForUpdate()->findOrFail($actor->user->id);

            // a deletion that began (or a purge that ended) after the check above: the project is gone; DeleteProject
            // holds its row until it commits
            $current = Project::query()->sharedLock()->find($project->id);

            if ($current === null || $current->deleting_at !== null) {
                throw Problem::notFound();
            }

            $mine = Favorite::query()->where('user_id', $actor->user->id);
            $existing = (clone $mine)->where('favoritable_type', 'project')->where('favoritable_id', $project->id)->first();

            if ($existing !== null) {
                $existing->delete();
                EventRecorder::record(EventType::FavoriteRemoved, $actor, $project, null);

                return false;
            }

            Favorite::query()->create([
                'user_id' => $actor->user->id,
                'favoritable_type' => 'project',
                'favoritable_id' => $project->id,
                'position' => ((int) ($mine->max('position') ?? -1)) + 1,
            ]);
            EventRecorder::record(EventType::FavoriteAdded, $actor, $project, null);

            return true;
        });

        return ['kind' => 'project', 'id' => $project->id, 'favorite' => $favorite];
    }
}
