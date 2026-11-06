<?php

namespace App\Actions\Resolutions;

use App\Domain\Workflow\StateCategory;
use App\Models\Resolution;
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
 * The resolutions of the organization by `position`, then by ULID (a unique order for the cursor, P12). Archived ones
 * belong to the list, items keep them. Every account reads them.
 */
final class ListResolutions
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::exact('default_for', 'resolutions.default_for', array_column(StateCategory::cases(), 'value')),
                ListFilter::scope('archived', 'boolean', fn (Builder $query, mixed $archived) => $archived ? $query->whereNotNull('resolutions.archived_at') : $query->whereNull('resolutions.archived_at')),
            ],
            sorts: ['position' => 'resolutions.position', 'label' => 'resolutions.label'],
            default: ['position'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Resolution>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(Resolution::query(), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
