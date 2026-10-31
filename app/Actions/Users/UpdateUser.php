<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\AccountInput;
use App\Support\Actor;
use App\Support\ImageInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Changes a profile: everybody their own, org admins anybody's. Name, handle, language, time zone and avatar; the
 * e-mail address of a person and the description and responsible person of a bot only org admins (bots have no
 * address, people neither description nor responsible person), a new e-mail address only from the session of the
 * interface (P6: a token could otherwise take an account over through "forgot password"). The rights are checked only
 * for the fields that really change, so a client may send the whole object back. Only the fields the input names
 * change; the event `user.updated` lists what really changed, and nothing changed means no event and no write.
 */
final class UpdateUser
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     * @throws Problem 403 `session_required` for a new e-mail address through a token (P6)
     */
    public function handle(Actor $actor, User $user, array $input): User
    {
        Authorize::check($actor, 'update', $user);

        foreach (['name', 'description', 'email'] as $field) {
            if (is_string($input[$field] ?? null)) {
                $input[$field] = trim($input[$field]);
            }
        }

        $input = AccountInput::normalize($input);

        if (is_string($input['email'] ?? null)) {
            $input['email'] = Str::lower($input['email']);
        }

        $current = [
            'name' => $user->name,
            'handle' => $user->handle,
            'email' => $user->email,
            'locale' => $user->locale?->value,
            'timezone' => $user->timezone,
            'description' => $user->description,
            'owner_id' => $user->owner_id,
        ];

        $changing = fn (string $field): bool => array_key_exists($field, $input) && $input[$field] !== $current[$field];

        if ($user->isPerson() && $changing('email')) {
            Authorize::check($actor, 'changeEmail', $user);

            if ($actor->token !== null) {
                throw Problem::forbidden(__('problem.reason.session_required'), 'session_required');
            }
        }

        if ($user->isBot() && ($changing('description') || $changing('owner_id'))) {
            Authorize::check($actor, 'configureBot', $user);
        }

        $avatar = ImageInput::url($user, 'avatar');

        $valid = Validator::make($input, [
            'name' => ['sometimes', 'required', 'string', 'max:'.AccountInput::NAME_MAX],
            'handle' => ['sometimes', ...AccountInput::handle($user)],
            'email' => $user->isBot()
                ? ['prohibited']
                : ['sometimes', 'required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
            'locale' => ['sometimes', 'required', Rule::in(Locale::values())],
            'timezone' => ['sometimes', 'required', 'string', 'timezone:all'],
            'avatar_url' => ['sometimes', ...ImageInput::rules($avatar)],
            'description' => $user->isBot() ? ['sometimes', 'nullable', 'string', 'max:'.AccountInput::DESCRIPTION_MAX] : ['prohibited'],
            'owner_id' => $user->isBot() ? ['sometimes', 'nullable', 'bail', 'string', 'ulid', AccountInput::owner()] : ['prohibited'],
        ], [...AccountInput::messages(), ...ImageInput::messages('avatar_url')])->validate();

        $changes = [];

        foreach ($current as $field => $old) {
            if (array_key_exists($field, $valid) && $valid[$field] !== $old) {
                $changes[$field] = ['old' => $old, 'new' => $valid[$field]];
            }
        }

        DB::transaction(function () use ($actor, $user, $valid, $avatar, $changes): void {
            if (array_key_exists('avatar_url', $valid)) {
                $changes += array_filter(['avatar_url' => ImageInput::apply($user, 'avatar', $valid['avatar_url'], $avatar)]);
            }

            if ($changes === []) {
                return;
            }

            $user->update(array_map(fn (array $change) => $change['new'], array_diff_key($changes, ['avatar_url' => true])));
            EventRecorder::record(EventType::UserUpdated, $actor, $user, null, $changes);
        });

        return $user;
    }
}
