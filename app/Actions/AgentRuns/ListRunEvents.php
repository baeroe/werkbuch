<?php

namespace App\Actions\AgentRuns;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
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
 * The log of a run (spec 6.4, 10.6): its lines in the order they came, for who sees the run. `filter[after]` (the ULID
 * of a line, any case) gives only the lines after it: the item reads what came since its last line when the live
 * message `agent_run.log` says there are new ones (WEBU-28, A641); a text that is no ULID matches nothing (A96).
 */
final class ListRunEvents
{
    use AsAction;

    /** The order the lines came in, not sortable; `after` narrows it to the lines after one. */
    public static function spec(): ListSpec
    {
        return new ListSpec([
            ListFilter::scope('after', 'string', fn (Builder $query, mixed $id) => is_string($id) && Str::isUlid($id = Ids::normalize($id))
                ? $query->where('agent_run_events.id', '>', $id)
                : $query->whereRaw('0 = 1'), 'Only the lines after this line (its ULID).'),
        ], sortable: false);
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter[after]`, `cursor`, `per_page`
     * @return ListResult<AgentRunEvent>
     *
     * @throws Problem 404
     * @throws ValidationException
     */
    public function handle(Actor $actor, AgentRun $run, array $input): ListResult
    {
        Authorize::check($actor, 'view', $run);

        [$query, $signature] = ListQuery::apply(AgentRunEvent::query()->where('run_id', $run->id)->orderBy('id'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
