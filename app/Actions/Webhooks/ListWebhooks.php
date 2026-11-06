<?php

namespace App\Actions\Webhooks;

use App\Access\Authorize;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Webhook;
use App\Support\Actor;
use App\Support\Ids;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Every webhook of the organization and its projects, by name and then ULID (a unique order for the cursor); only
 * accounts with `org.manage` read them. The list counts no deliveries per row (P5).
 */
final class ListWebhooks
{
    use AsAction;

    /** The rules of the list (A386, K7). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::scope('project_id', 'string', function (Builder $query, mixed $id) {
                    // a project being deleted is none to the list, like an unknown id (Review Focus 5)
                    $id = Ids::normalize($id);

                    return is_string($id) && Str::isUlid($id)
                        ? $query->where('webhooks.project_id', $id)->whereIn('webhooks.project_id', Project::query()->whereNull('deleting_at')->select('id'))
                        : $query->whereRaw('0 = 1');
                }),
                ListFilter::boolean('active', 'webhooks.active'),
                ListFilter::ulid('bot_id', 'webhooks.bot_id'),
            ],
            sorts: ['name' => 'webhooks.name', 'created_at' => 'webhooks.id'],
            default: ['name'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<Webhook>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        Authorize::check($actor, 'manageWebhooks', Organization::class);

        [$query, $signature] = ListQuery::apply(Webhook::query(), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
