<?php

namespace App\Actions\Agents;

use App\Access\Authorize;
use App\Access\RunTokenGuard;
use App\Actions\GitHub\DisconnectGitHub;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\AgentThread;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\AgentFlow;
use App\Support\ItemLock;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * „Weitermachen“ at an item (spec 10.6, WEBU-28, A642): a strand that waits since GitHub was disconnected
 * (`DisconnectGitHub::REASON`) goes on once the project has its repo again. Who may change the item resumes it, never
 * an agent through the token of its run. The strand opens and starts a correction with what people wrote since its
 * last run; its brakes keep counting (a strand at its brake pauses again, `braked`). Refused with 409:
 * `project_archived`, `archived` (the project or the item is archived), `thread_not_resumable` (no strand waits for
 * GitHub, or the item is assigned to someone else than its bot), the code of `AgentFlow::refusal` with its sentence
 * (the bot works here as an agent no more: `agent_off`, `default_bot`, `disabled`, `no_owner`, `no_steps`,
 * `not_member`, A647), `no_repository` (no repo, or another one than the strand's), `merge_guard_open` (a guard holds
 * the project); nothing changes then.
 */
final class ResumeThread
{
    use AsAction;

    /**
     * @return array{run: AgentRun|null, braked: bool}
     *
     * @throws Problem 403, 404, 409
     */
    public function handle(Actor $actor, WorkItem $item): array
    {
        Authorize::check($actor, 'update', $item);
        RunTokenGuard::refuse($actor);

        return DB::transaction(function () use ($actor, $item): array {
            // item → runs → strand, as every action of the flow (A592)
            $locked = ItemLock::take($item);
            ItemLock::refuseArchived($locked);
            $thread = AgentFlow::threadAt($locked->id);
            if ($thread === null) {
                throw self::notResumable();
            }
            [, $strand] = AgentFlow::lockStrand($thread);

            if ($strand->status !== AgentThread::PAUSED || $strand->pause_reason !== DisconnectGitHub::REASON) {
                throw self::notResumable();
            }
            if ($locked->assignee_id !== $strand->bot_id) {
                throw Problem::conflict('thread_not_resumable', [], __('problem.detail.resume_reassigned'));
            }

            // the bot works here as an agent no more: its own reason, never the blanket `agent_off` of EnqueueRun (A647)
            $bot = User::query()->findOrFail($strand->bot_id);
            $refusal = AgentFlow::refusal($bot, $locked->project);
            if ($refusal !== null) {
                throw Problem::conflict($refusal, [], __('items.agents.refusal.'.$refusal, ['bot' => $bot->name, 'project' => $locked->project->name]));
            }

            $repository = AgentFlow::repositoryOf($locked->project_id);
            if ($repository === null || ($strand->repository_github_id !== null && $repository->repository->github_id !== $strand->repository_github_id)) {
                throw Problem::conflict('no_repository', [], __('problem.detail.resume_no_repository'));
            }
            if ($repository->guarded()) {
                throw Problem::conflict('merge_guard_open');
            }

            $strand->forceFill(['status' => AgentThread::OPEN, 'pause_reason' => null])->save();
            $findings = __('agents.findings.resume', [], AgentFlow::locale())."\n\n".AgentFlow::commentsSince($strand, $locked);
            $run = StartCorrection::run($actor, $strand, 'comments', $findings);

            // the brakes kept counting: a strand at its brake paused again (StartCorrection, PauseThread). Nothing else
            // makes StartCorrection answer null at the strand it just opened: the refusal above read the configuration
            // of the bot in the snapshot EnqueueRun reads it in, so EnqueueRun refuses nothing here
            return ['run' => $run, 'braked' => $run === null];
        }, 3);
    }

    private static function notResumable(): Problem
    {
        return Problem::conflict('thread_not_resumable', [], __('problem.detail.resume_not_paused'));
    }
}
