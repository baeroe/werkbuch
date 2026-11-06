<?php

namespace App\Actions\Users;

use App\Enums\AccountType;
use App\Models\User;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every account, deactivated ones included (history and old assignments still point to them), optionally only people
 * or only bots. People come first (`person` > `bot`), then the ULID: a unique order for the cursor (P12); the screens
 * sort by name themselves. Every account sees the list. The list of the bots (`GET /bots`, `$bots`) holds bots only and
 * filters by their owner instead of the type.
 */
final class ListUsers
{
    use AsAction;

    /** The rules of `GET /users` (A386, K7: people first). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::exact('type', 'users.type', array_column(AccountType::cases(), 'value')),
                self::disabled(),
            ],
            sorts: ['type' => 'users.type', 'name' => 'users.name', 'handle' => 'users.handle', 'created_at' => 'users.id'],
            default: ['-type'],
        );
    }

    /** The rules of `GET /bots`: the type is fixed, the owner is a filter. */
    public static function botSpec(): ListSpec
    {
        return new ListSpec(
            filters: [self::disabled(), ListFilter::ulid('owner_id', 'users.owner_id')],
            sorts: ['name' => 'users.name', 'created_at' => 'users.id'],
        );
    }

    private static function disabled(): ListFilter
    {
        return ListFilter::scope('disabled', 'boolean', fn (Builder $query, mixed $disabled) => $disabled
            ? $query->whereNotNull('users.disabled_at') : $query->whereNull('users.disabled_at'));
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<User>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input, bool $bots = false): ListResult
    {
        $query = User::query()->with('media')->when($bots, fn (Builder $query) => $query->where('users.type', AccountType::Bot->value));
        [$query, $signature] = ListQuery::apply($query, $input, $bots ? self::botSpec() : self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
