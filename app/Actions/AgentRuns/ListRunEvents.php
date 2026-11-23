<?php

namespace App\Actions\AgentRuns;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
use App\Support\Actor;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The log of a run (spec 6.4, 10.6): its lines in the order they came, for who sees the run.
 */
final class ListRunEvents
{
    use AsAction;

    /** A fixed list: the order the lines came in. */
    public static function spec(): ListSpec
    {
        return ListSpec::fixed();
    }

    /**
     * @param  array<array-key, mixed>  $input  `cursor`, `per_page`
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
