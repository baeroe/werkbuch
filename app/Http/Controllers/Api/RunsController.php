<?php

namespace App\Http\Controllers\Api;

use App\Actions\AgentRuns\CancelRun;
use App\Actions\AgentRuns\GetRun;
use App\Actions\AgentRuns\ListRunEvents;
use App\Actions\AgentRuns\ListRuns;
use App\Actions\AgentRuns\RetryRun;
use App\Http\Api\ApiList;
use App\Http\Api\ListOf;
use App\Http\Controllers\Controller;
use App\Http\Resources\AgentRunEventResource;
use App\Http\Resources\AgentRunResource;
use App\Models\AgentRun;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The runs of agents (spec 7.5, 10.6): who sees the project reads them; who may change the item (and org admins)
 * cancels them and starts them again. `{run}` is bound by ULID only (any case).
 */
final class RunsController extends Controller
{
    /**
     * List the runs.
     *
     * The runs of the projects the account sees, the newest first; `filter[work_item_id]` for those of an item, `filter[runner_id]` for those of a runner.
     */
    #[ListOf(ListRuns::class)]
    public function index(Request $request): JsonResponse
    {
        return ApiList::respond(ListRuns::run(Actor::fromRequest($request), $request->query()), AgentRunResource::class);
    }

    /**
     * Read a run.
     */
    public function show(Request $request, AgentRun $run): AgentRunResource
    {
        return new AgentRunResource(GetRun::run(Actor::fromRequest($request), $run));
    }

    /**
     * List the log of a run.
     *
     * The lines in the order they came, with `filter[after]` only those after a line; at most 2000 or 1 MB per run (`events_dropped` of the run counts the older ones that went).
     */
    #[ListOf(ListRunEvents::class)]
    public function events(Request $request, AgentRun $run): JsonResponse
    {
        return ApiList::respond(ListRunEvents::run(Actor::fromRequest($request), $run, $request->query()), AgentRunEventResource::class);
    }

    /**
     * Cancel a run.
     *
     * A waiting run ends at once; one on a runner becomes `canceling` until the runner stopped it. 409 `run_finished` for a run that ended.
     */
    public function cancel(Request $request, AgentRun $run): AgentRunResource
    {
        return new AgentRunResource(CancelRun::run(Actor::fromRequest($request), $run)->load('runner'));
    }

    /**
     * Start a run again.
     *
     * 201 with the new run: of a run that ended without success, the same kind, agent, item and strand. 409 `run_not_retryable` otherwise.
     */
    public function retry(Request $request, AgentRun $run): JsonResponse
    {
        return (new AgentRunResource(RetryRun::run(Actor::fromRequest($request), $run)))->response()->setStatusCode(201);
    }
}
