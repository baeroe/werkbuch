<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Models\AgentRun;
use App\Support\Actor;
use App\Support\ListFilter;
use App\Support\ListQuery;
use App\Support\ListResult;
use App\Support\ListSpec;
use App\Support\PageArgs;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The runs the account sees (spec 10.1, 10.6, A483): of the projects it sees, the newest first; `filter[work_item_id]`
 * for the runs of an item, `filter[runner_id]` for those of a runner, by status, kind, agent or project.
 */
final class ListRuns
{
    use AsAction;

    /** The rules of the list (A386). */
    public static function spec(): ListSpec
    {
        return new ListSpec(
            filters: [
                ListFilter::ulid('work_item_id', 'agent_runs.work_item_id'),
                ListFilter::ulid('runner_id', 'agent_runs.runner_id'),
                ListFilter::ulid('bot_id', 'agent_runs.bot_id'),
                ListFilter::ulid('project_id', 'agent_runs.project_id'),
                ListFilter::exact('status', 'agent_runs.status', RunStatus::VALUES),
                ListFilter::exact('type', 'agent_runs.type', RunType::VALUES),
            ],
            sorts: ['created_at' => 'agent_runs.id'],
            default: ['-created_at'],
        );
    }

    /**
     * @param  array<array-key, mixed>  $input  `filter`, `sort`, `cursor`, `per_page`
     * @return ListResult<AgentRun>
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): ListResult
    {
        [$query, $signature] = ListQuery::apply(AgentRun::query()->visibleTo($actor->user)->with('runner'), $input, self::spec());

        return ListResult::of($query, PageArgs::from($input), $signature);
    }
}
