<?php

namespace App\Http\Controllers\Api;

use App\Actions\Agents\ResumeThread;
use App\Http\Api\Answer;
use App\Http\Controllers\Controller;
use App\Http\Resources\AgentRunResource;
use App\Models\WorkItem;
use App\OpenApi\AgentSchemas;
use App\Support\Actor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The strand of an agent at an item (spec 7.5, 10.6): who may change the item resumes it after GitHub was disconnected.
 */
final class AgentThreadsController extends Controller
{
    /**
     * Resume the strand of an item.
     *
     * A strand that waits since GitHub was disconnected goes on with a correction once the project has its repo again; its
     * brakes keep counting (`braked`). 409 `project_archived`, `archived`, `thread_not_resumable`, `no_repository`,
     * `merge_guard_open`, or why the bot works here as an agent no more (`agent_off`, `default_bot`, `disabled`,
     * `no_owner`, `no_steps`, `not_member`, the sentence in `detail`).
     */
    #[Answer(200, AgentSchemas::class, 'resumed', 'The strand goes on.')]
    public function resume(Request $request, WorkItem $item): JsonResponse
    {
        $resumed = ResumeThread::run(Actor::fromRequest($request), $item);

        return response()->json(['data' => [
            'run' => $resumed['run'] === null ? null : (new AgentRunResource($resumed['run']->load('runner')))->resolve($request),
            'braked' => $resumed['braked'],
        ]]);
    }
}
