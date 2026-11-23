<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\RunStatus;
use App\Domain\Agents\RunType;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\AgentRun;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\RunAttempts;
use App\Support\RunnerProtocol;
use App\Support\RunTokens;
use App\Support\Secrets;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The result of a run as its runner reports it (spec 6.4): `succeeded`, `failed`, `canceled` or `timed_out`, the session
 * of the CLI, and by kind the verdict and findings (`review`), the answer (`comment`), the pushed commit and a summary
 * (`task`, `correction`, `conflict`), the usage when the CLI tells it, the error of a failure. What werkbuch does with it
 * comes with the flow (WEBU-26). `end` is how every run ends, also for the reaper, a cancel and a revocation.
 */
final class FinishRun
{
    use AsAction;

    public const TEXT_MAX = 65_535;

    public const SUMMARY_MAX = 2000;

    public const ERROR_MAX = 500;

    /**
     * @param  array<array-key, mixed>  $input  `attempt`, `status`, `session_id`, `verdict`, `text`, `commit`, `summary`, `usage`, `error`
     *
     * @throws ValidationException
     * @throws Problem 404, 409 `run_replaced`
     */
    public function handle(Actor $actor, Runner $runner, string $runId, array $input): AgentRun
    {
        $valid = Validator::make($input, [
            'status' => ['required', Rule::in(RunStatus::REPORTED)],
            'session_id' => ['sometimes', 'nullable', 'string', 'max:200'],
            'verdict' => ['sometimes', 'nullable', Rule::in(['approve', 'changes'])],
            'text' => ['sometimes', 'nullable', 'string', 'max:'.self::TEXT_MAX],
            'commit' => ['sometimes', 'nullable', 'string', 'regex:/^[0-9a-f]{7,64}\z/'],
            'summary' => ['sometimes', 'nullable', 'string', 'max:'.self::SUMMARY_MAX],
            'usage' => ['sometimes', 'nullable', 'array:input,output'],
            'usage.input' => ['required_with:usage', 'integer', 'min:0'],
            'usage.output' => ['required_with:usage', 'integer', 'min:0'],
            'error' => ['sometimes', 'nullable', 'string', 'max:'.self::ERROR_MAX],
        ], [
            'status' => __('field.status.runner'),
            'session_id' => __('field.session_id.invalid'),
            'verdict' => __('field.verdict.invalid'),
            'text' => __('field.text.max', ['max' => self::TEXT_MAX]),
            'commit' => __('field.commit.invalid'),
            'summary' => __('field.summary.max', ['max' => self::SUMMARY_MAX]),
            'usage' => __('field.usage.invalid'),
            'usage.*' => __('field.usage.invalid'),
            'error' => __('field.error.max', ['max' => self::ERROR_MAX]),
        ])->validate();
        RunnerProtocol::keep($runner, [], RunnerProtocol::version($input['version'] ?? null), RunnerProtocol::protocol($input['protocol'] ?? null));

        return DB::transaction(function () use ($runner, $runId, $input, $valid): AgentRun {
            $run = RunAttempts::lock($runner, $runId, $input['attempt'] ?? null);
            $status = RunStatus::from($valid['status']);

            $result = array_filter([
                'verdict' => $run->type === RunType::Review ? ($valid['verdict'] ?? null) : null,
                'text' => isset($valid['text']) ? Secrets::blank($valid['text']) : null,
                'commit' => $valid['commit'] ?? null,
                'summary' => isset($valid['summary']) ? Secrets::blank($valid['summary']) : null,
            ], fn (mixed $value) => $value !== null);

            if (isset($valid['session_id']) && $run->thread !== null && $run->type !== RunType::Review) {
                $run->thread->forceFill(['session_id' => $valid['session_id']])->save();
            }

            self::end($run, $status, [
                'result' => $result === [] ? null : $result,
                'session_id' => $valid['session_id'] ?? null,
                'usage' => $valid['usage'] ?? null,
                'error' => isset($valid['error']) ? Secrets::blank($valid['error']) : null,
            ]);

            return $run;
        }, 3);
    }

    /**
     * Ends a run in the transaction of the caller, the run locked: its final status and what came of it, no lease, the
     * time of the end, its token revoked (spec 11.2), and `agent_run.finished` with the status, recorded as the flow of
     * the agent (spec 7.2).
     *
     * @param  array<string, mixed>  $fields  more columns of the end (result, error, session, usage)
     */
    public static function end(AgentRun $locked, RunStatus $status, array $fields = []): void
    {
        $locked->forceFill([...$fields, 'status' => $status, 'lease_expires_at' => null, 'finished_at' => now(), 'waiting_reason' => null])->save();
        RunTokens::revoke($locked);

        EventRecorder::record(EventType::AgentRunFinished, Actor::agent($locked->bot), $locked, $locked->project, [
            'status' => ['old' => null, 'new' => $status->value],
        ], ['item_id' => $locked->work_item_id, 'attempt' => $locked->attempt]);
    }
}
