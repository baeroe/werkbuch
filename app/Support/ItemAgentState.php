<?php

namespace App\Support;

use App\Domain\Workflow\AgentStep;
use App\Models\AgentProjectSettings;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\ProjectRepository;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItem;

/**
 * What the agents do at an item (`include=agent`, WEBU-28, A640), for whoever sees the item: the open or paused strand
 * with its counters and PR (of an epic on its own branch also the child at work, WEBU-71), how many runs the item had (any status, so the browser asks for them only when it had
 * some), why the bot the item is assigned to is no agent here (`AgentFlow::refusal`, only a reason
 * code, never the configuration of the bot), the brakes of the project, whether it has a repo, and the guard against
 * an unauthorized merge (`here`: a run of this item came before it). A fixed number of queries, whatever the strand ran.
 */
final class ItemAgentState
{
    /**
     * @return array{
     *     thread: array{id: string, bot_id: string, status: string, pause_reason: string|null, corrections: int, conflicts: int, pr_number: int|null, branch: string|null, runner_id: string|null, child: array{id: string, key: string}|null}|null,
     *     runs: int,
     *     refusal: string|null,
     *     ready_state: string|null,
     *     blocked_by: list<string>,
     *     brakes: array{max_corrections: int, max_conflicts: int},
     *     repository: bool,
     *     guard: array{branch: string|null, sha: string|null, here: bool}|null,
     * }
     */
    public static function of(WorkItem $item): array
    {
        $thread = AgentFlow::threadAt($item->id);
        $assignee = $item->assignee_id === null ? null : User::query()->find($item->assignee_id);
        $settings = AgentProjectSettings::of($item->project_id);
        $repository = ProjectRepository::query()->where('project_id', $item->project_id)->first();

        $refusal = $assignee !== null && $assignee->isBot() ? AgentFlow::refusal($assignee, $item->project) : null;

        return [
            'thread' => $thread === null ? null : [
                'id' => $thread->id,
                'bot_id' => $thread->bot_id,
                'status' => $thread->status,
                'pause_reason' => $thread->pause_reason,
                'corrections' => $thread->corrections,
                'conflicts' => $thread->conflicts,
                'pr_number' => $thread->pr_number,
                'branch' => $thread->branch,
                'runner_id' => $thread->runner_id,
                'child' => self::child($thread),
            ],
            'runs' => AgentRun::query()->where('work_item_id', $item->id)->count(),
            'refusal' => $refusal,
            'ready_state' => $assignee !== null && $assignee->isBot() && $refusal === null && $thread === null && $item->archived_at === null && ! AgentFlow::readyToBegin($item)
                ? WorkflowState::query()->whereKey(Workflow::query()->find($item->project->workflow_id)?->agentState(AgentStep::Ready))->value('name') : null,
            'blocked_by' => $assignee !== null && $assignee->isBot() && $refusal === null && $thread === null && $item->archived_at === null ? AgentFlow::blockers($item) : [],
            'brakes' => ['max_corrections' => $settings->max_corrections, 'max_conflicts' => $settings->max_conflicts],
            'repository' => $repository !== null,
            'guard' => $repository === null || ! $repository->guarded() ? null : [
                'branch' => $repository->guard_branch,
                'sha' => $repository->guard_sha,
                'here' => collect($repository->guard_runs ?? [])->contains(fn (array $run) => ($run['item_id'] ?? null) === $item->id),
            ],
        ];
    }

    /**
     * The child of an epic on its own branch whose strand is open now (WEBU-71): one at a time.
     *
     * @return array{id: string, key: string}|null
     */
    private static function child(AgentThread $thread): ?array
    {
        $child = ! $thread->per_child ? null : WorkItem::query()->whereIn('id', AgentThread::query()->select('work_item_id')
            ->where('parent_thread_id', $thread->id)->where('status', AgentThread::OPEN))->orderBy('rank')->orderBy('id')->first();

        return $child === null ? null : ['id' => $child->id, 'key' => $child->key];
    }
}
