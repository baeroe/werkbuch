<?php

namespace App\Support;

use App\Domain\Accounts\Handle;
use App\Enums\AccountType;
use App\Models\User;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

/**
 * The rules and field messages (P9) of an account's fields that UpdateUser and CreateBot share.
 */
final class AccountInput
{
    public const NAME_MAX = 120;

    public const DESCRIPTION_MAX = 500;

    /**
     * The input with the responsible person the way it is stored: ULIDs are lower case, and the collation would let an
     * upper-case one pass `exists`.
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function normalize(array $input): array
    {
        if (is_string($input['owner_id'] ?? null)) {
            $input['owner_id'] = strtolower($input['owner_id']);
        }

        return $input;
    }

    /**
     * A valid handle no other account holds (spec 4.2).
     *
     * @return list<mixed>
     */
    public static function handle(?User $own = null): array
    {
        return ['required', 'string', 'regex:'.Handle::PATTERN, Rule::unique('users', 'handle')->ignore($own?->id)];
    }

    /**
     * The responsible person of a bot: an active person.
     */
    public static function owner(): Exists
    {
        return Rule::exists('users', 'id')->where('type', AccountType::Person->value)->whereNull('disabled_at');
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.invalid'),
            'name.max' => __('field.name.max'),
            'handle.required' => __('field.handle.format'),
            'handle.string' => __('field.handle.format'),
            'handle.regex' => __('field.handle.format'),
            'handle.unique' => __('field.handle.taken'),
            'email.prohibited' => __('field.email.bots'),
            'email.required' => __('field.email.invalid'),
            'email.string' => __('field.email.invalid'),
            'email.email' => __('field.email.invalid'),
            'email.max' => __('field.email.invalid'),
            'email.unique' => __('field.email.taken'),
            'locale.required' => __('field.locale.unknown'),
            'locale.in' => __('field.locale.unknown'),
            'timezone.required' => __('field.timezone.unknown'),
            'timezone.string' => __('field.timezone.unknown'),
            'timezone.timezone' => __('field.timezone.unknown'),
            'description.prohibited' => __('field.description.people'),
            'description.string' => __('field.description.invalid'),
            'description.max' => __('field.description.max'),
            'owner_id.prohibited' => __('field.owner_id.people'),
            'owner_id.required' => __('field.owner_id.invalid'),
            'owner_id.string' => __('field.owner_id.invalid'),
            'owner_id.exists' => __('field.owner_id.invalid'),
        ];
    }
}
