<?php

namespace App\Actions\Runners;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The runners of the organization (spec 10.1, org admins): the active ones, by name; a revoked runner is gone from the
 * list (its runs still name it).
 */
final class ListRunners
{
    use AsAction;

    /** The rules of the list (A386). */
    public static function spec(): ListSpec
    {
        return new ListSpec(sorts: ['name' => 'runners.name', 'created_at' => 'runners.id'], default: ['name']);
    }

    /**
     * @param  array<array-key, mixed>  $input  `sort`, `cursor`, `per_page`
     * @return ListResult<Runner>
     *
     * @throws Problem 403
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'manageRunners', Organization::class);

        [$query, $signature] = ListQuery::apply(Runner::query()->whereNull('revoked_at')->with('busyRuns'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
