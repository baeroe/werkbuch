<?php

namespace App\Actions\Tokens;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\NewAccessToken;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates an API token for an account (spec 4.2): a name, the abilities `read`, `write` and `mcp` (at least one, in
 * this order, without repeats), optionally an expiry in the future. The answer carries the plain text, which nothing
 * shows again. The abilities always go to Sanctum by name: without them it would grant `*`, which every check lets through.
 */
final class CreateToken
{
    use AsAction;

    public const ABILITIES = ['read', 'write', 'mcp'];

    public const NAME_MAX = 120;

    /**
     * @param  array<string, mixed>  $input  `name`, `abilities`, `expires_at`
     *
     * @throws Problem 403 for a deactivated account
     * @throws ValidationException
     */
    public function handle(Actor $actor, User $owner, array $input): NewAccessToken
    {
        Authorize::check($actor, 'manageTokens', $owner);

        if ($owner->isDisabled()) {
            throw Problem::forbidden(__('problem.detail.token_disabled_owner'));
        }

        if (is_string($input['name'] ?? null)) {
            $input['name'] = trim($input['name']);
        }

        $valid = Validator::make($input, [
            'name' => ['required', 'string', 'max:'.self::NAME_MAX],
            // `in` on a list checks every entry, so an unknown ability is an error of the list, not of its entry
            'abilities' => ['required', 'array', 'list', Rule::in(self::ABILITIES)],
            'expires_at' => ['nullable', 'date', 'after:now'],
        ], [
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.invalid'),
            'name.max' => __('field.name.max', ['max' => self::NAME_MAX]),
            'abilities' => __('field.abilities.required'),
            'expires_at' => __('field.expires_at.future'),
        ])->validate();

        $abilities = array_values(array_intersect(self::ABILITIES, $valid['abilities']));
        $expiresAt = isset($valid['expires_at']) ? Carbon::parse($valid['expires_at'])->utc() : null;

        return DB::transaction(function () use ($actor, $owner, $valid, $abilities, $expiresAt): NewAccessToken {
            $token = $owner->createToken($valid['name'], $abilities, $expiresAt);
            EventRecorder::record(EventType::TokenCreated, $actor, $token->accessToken, null);

            return $token;
        });
    }
}
