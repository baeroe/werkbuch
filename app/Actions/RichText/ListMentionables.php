<?php

namespace App\Actions\RichText;

use App\Access\Assignable;
use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Who can be mentioned with `@` in a text of a project (spec 4.16, `matchPeople` of the clickdummy): the accounts who can
 * take work in it (Assignable: active members, active persons who are org admins, bots only as members, the default
 * bot too), whose name or handle holds `q`. Starts of a word of the name or of the handle come first, then hits inside a
 * word; within each, people before bots, then by name. A read: whoever sees the project may ask.
 */
final class ListMentionables
{
    use AsAction;

    /** The keys of the query (the OpenAPI document names them, K15); others are passed over. */
    public const KEYS = ['project', 'q', 'limit'];

    public const DEFAULT_LIMIT = 20;

    public const MAX_LIMIT = 50;

    public const Q_MAX = 64;

    /**
     * @param  array<array-key, mixed>  $query  `project` (ULID, identifier or former identifier), `q`, `limit`
     * @return EloquentCollection<int, User> with their avatars
     *
     * @throws ValidationException
     * @throws Problem 404 for a project the account does not see (unknown, private, being deleted)
     */
    public function handle(Actor $actor, array $query): EloquentCollection
    {
        [$reference, $q, $limit] = self::input($query);

        $project = Project::findByReference($reference) ?? throw Problem::notFound();
        Authorize::check($actor, 'view', $project);

        $users = Assignable::query($project)->with('media');

        if ($q !== '') {
            $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
            $users->where(fn ($match) => $match->where('users.name', 'like', "%{$like}%")->orWhere('users.handle', 'like', "%{$like}%"))
                ->orderByRaw(
                    'case when users.handle like ? or users.name like ? or users.name like ? then 0 else 1 end',
                    ["{$like}%", "{$like}%", "% {$like}%"],
                );
        }

        return $users->orderByDesc('users.type')->orderBy('users.name')->orderBy('users.id')->limit($limit)->get();
    }

    /**
     * The checked query: all field errors in one answer, other keys passed over.
     *
     * @param  array<array-key, mixed>  $query
     * @return array{string, string, int}
     *
     * @throws ValidationException
     */
    private static function input(array $query): array
    {
        $errors = [];

        $reference = $query['project'] ?? null;
        if (! is_string($reference) || Str::trim($reference) === '') {
            $errors['project'] = __('field.required');
        }

        $q = $query['q'] ?? '';
        if (! is_string($q)) {
            // a list or an object is no search: refused, not taken for none (T11-M1)
            $errors['q'] = __('field.q.invalid');
            $q = '';
        }
        $q = Str::trim($q);
        if (mb_strlen($q) > self::Q_MAX) {
            $errors['q'] = __('field.q.max', ['max' => self::Q_MAX]);
        }

        $limit = $query['limit'] ?? null;
        if ($limit === null) {
            $limit = self::DEFAULT_LIMIT;
        } elseif ((is_int($limit) || (is_string($limit) && preg_match('/^\d+\z/', $limit) === 1)) && (int) $limit >= 1 && (int) $limit <= self::MAX_LIMIT) {
            $limit = (int) $limit;
        } else {
            $errors['limit'] = __('field.limit.invalid', ['max' => self::MAX_LIMIT]);
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        /** @var array{string, string, int} */
        return [Str::trim((string) $reference), $q, $limit];
    }
}
