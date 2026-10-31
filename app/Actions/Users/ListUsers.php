<?php

namespace App\Actions\Users;

use App\Enums\AccountType;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListResult;
use App\Support\PageArgs;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every account, deactivated ones included (history and old assignments still point to them), optionally only people
 * or only bots. People come first (`person` > `bot`), then the ULID: a unique order for the cursor (P12); the screens
 * sort by name themselves. Every account sees the list.
 */
final class ListUsers
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `type` (`person`, `bot`), `cursor`, `per_page`
     * @return ListResult<User>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        $valid = Validator::make($input, [
            'type' => ['nullable', 'string', Rule::in(array_column(AccountType::cases(), 'value'))],
        ], [
            'type.string' => __('field.type.unknown'),
            'type.in' => __('field.type.unknown'),
        ])->validate();

        $query = User::query()->with('media')
            ->when($valid['type'] ?? null, fn ($query, string $type) => $query->where('type', $type))
            ->orderByDesc('type')
            ->orderBy('id');

        return ListResult::of($query, PageArgs::from($input));
    }
}
