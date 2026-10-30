<?php

namespace App\Actions\Users;

use App\Access\Authorize;
use App\Enums\Locale;
use App\Events\EventRecorder;
use App\Events\EventType;
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
 * address, people neither description nor responsible person). Only the fields the input names change; the event
 * `user.updated` lists what really changed, and nothing changed means no event and no write.
 */
final class UpdateUser
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, User $user, array $input): User
    {
        Authorize::check($actor, 'update', $user);

        if ($user->isPerson() && array_key_exists('email', $input)) {
            Authorize::check($actor, 'changeEmail', $user);
        }

        if ($user->isBot() && (array_key_exists('description', $input) || array_key_exists('owner_id', $input))) {
            Authorize::check($actor, 'configureBot', $user);
        }

        foreach (['name', 'description', 'email'] as $field) {
            if (is_string($input[$field] ?? null)) {
                $input[$field] = trim($input[$field]);
            }
        }

        if (is_string($input['email'] ?? null)) {
            $input['email'] = Str::lower($input['email']);
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
            'owner_id' => $user->isBot() ? ['sometimes', 'nullable', 'string', AccountInput::owner()] : ['prohibited'],
        ], [...AccountInput::messages(), ...ImageInput::messages('avatar_url')])->validate();

        $current = [
            'name' => $user->name,
            'handle' => $user->handle,
            'email' => $user->email,
            'locale' => $user->locale?->value,
            'timezone' => $user->timezone,
            'description' => $user->description,
            'owner_id' => $user->owner_id,
        ];

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
