<?php

namespace App\Actions\Favorites;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Favorite;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use App\Support\Actor;
use App\Support\Ids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Puts a project or a view into the sidebar of the account, or takes it out again, and answers the new state; any
 * other `kind` is a 422. A project the account does not see, and a view that does not exist, are a 404. The account's
 * own row is locked, so two toggles at the same time give consecutive positions and never a server error; the project
 * or view is read again under a shared lock after it, so a deletion at the same time leaves no favorite behind
 * (DeleteProject and DeleteView hold their row until they commit).
 * The events (`favorite.added`, `favorite.removed`) are personal: the project or view is their subject, but no project
 * activity.
 */
final class ToggleFavorite
{
    use AsAction;

    private const KINDS = ['project', 'view'];

    /**
     * @param  array<string, mixed>  $input  `kind`, `id`
     * @return array{kind: string, id: string, favorite: bool}
     *
     * @throws ValidationException
     * @throws Problem 404
     */
    public function handle(Actor $actor, array $input): array
    {
        /** @var array{kind: 'project'|'view', id: string} $valid */
        $valid = Validator::make($input, [
            'kind' => ['required', 'string', Rule::in(self::KINDS)],
            'id' => ['required', 'string'],
        ], [
            'kind.required' => __('field.kind.unknown'),
            'kind.string' => __('field.kind.unknown'),
            'kind.in' => __('field.kind.unknown'),
            'id.required' => __('field.id.invalid'),
            'id.string' => __('field.id.invalid'),
        ])->validate();

        $id = Ids::normalize($valid['id']);

        // a canonical ULID only: the collation would let a look-alike (fullwidth digits, accents) find the row
        if (! Str::isUlid($id)) {
            throw Problem::notFound();
        }

        $model = $valid['kind'] === 'project' ? Project::class : View::class;
        $target = $model::query()->whereKey($id)->first() ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $target);

        $favorite = DB::transaction(function () use ($actor, $model, $target): bool {
            User::query()->lockForUpdate()->findOrFail($actor->user->id);

            // a deletion that began (or a purge that ended) after the check above: the target is gone
            $current = $model::query()->sharedLock()->whereKey($target->getKey())->first();

            if ($current === null || ($current instanceof Project && $current->deleting_at !== null)) {
                throw Problem::notFound();
            }

            return self::toggle($actor, $current);
        });

        return ['kind' => $valid['kind'], 'id' => $target->getKey(), 'favorite' => $favorite];
    }

    /** Takes the favorite out if the account has it, else puts it at the end; whether it is a favorite now. */
    private static function toggle(Actor $actor, Model $target): bool
    {
        $mine = Favorite::query()->where('user_id', $actor->user->id);
        $existing = (clone $mine)->where('favoritable_type', $target->getMorphClass())->where('favoritable_id', $target->getKey())->first();

        if ($existing !== null) {
            $existing->delete();
            EventRecorder::record(EventType::FavoriteRemoved, $actor, $target, null);

            return false;
        }

        Favorite::query()->create([
            'user_id' => $actor->user->id,
            'favoritable_type' => $target->getMorphClass(),
            'favoritable_id' => $target->getKey(),
            'position' => ((int) ($mine->max('position') ?? -1)) + 1,
        ]);
        EventRecorder::record(EventType::FavoriteAdded, $actor, $target, null);

        return true;
    }
}
