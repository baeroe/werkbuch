<?php

namespace App\Actions\AgentRuns;

use App\Domain\Agents\Protocol;
use App\Exceptions\Problem;
use App\Live\RunLog;
use App\Models\AgentRun;
use App\Models\AgentRunEvent;
use App\Models\Runner;
use App\Support\Actor;
use App\Support\RunAttempts;
use App\Support\RunnerProtocol;
use App\Support\Secrets;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The log of a running run (spec 6.4, 7.5, A481): a batch of up to 100 lines the runner cut to the readable part of the
 * CLI's output. Each line keeps at most 4 000 characters, tokens in it are blanked (spec 2: no secret in a log); past
 * 2 000 lines or 1 MB per run the oldest go and the run counts them (`events_dropped`). Not through the outbox: the item
 * of the run hears of new lines through RunLog (`agent_run.log`, at most once a second, A641).
 */
final class RecordRunEvents
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `attempt`, `events` [{kind, text, at?}], `version` and `protocol` of the headers
     * @return array{stored: int, dropped: int}
     *
     * @throws ValidationException
     * @throws Problem 404, 409 `run_replaced`
     */
    public function handle(Actor $actor, Runner $runner, string $runId, array $input): array
    {
        $valid = Validator::make($input, [
            'events' => ['required', 'array', 'list', 'min:1', 'max:'.Protocol::EVENTS_PER_BATCH],
            'events.*' => ['array:kind,text,at'],
            'events.*.kind' => ['required', Rule::in(AgentRunEvent::KINDS)],
            'events.*.text' => ['present', 'string'],
            'events.*.at' => ['sometimes', 'nullable', 'date'],
        ])->setCustomMessages(['*' => __('field.events.runner', ['max' => Protocol::EVENTS_PER_BATCH])])->validate();
        RunnerProtocol::keep($runner, [], RunnerProtocol::version($input['version'] ?? null), RunnerProtocol::protocol($input['protocol'] ?? null));

        return DB::transaction(function () use ($runner, $runId, $input, $valid): array {
            $run = RunAttempts::lock($runner, $runId, $input['attempt'] ?? null);

            foreach ($valid['events'] as $event) {
                $text = Secrets::blank(mb_substr($event['text'], 0, Protocol::EVENT_TEXT_MAX));
                $at = isset($event['at']) ? Carbon::parse($event['at'])->utc() : now();
                AgentRunEvent::query()->create([
                    'run_id' => $run->id, 'attempt' => $run->attempt, 'kind' => $event['kind'], 'text' => $text,
                    'bytes' => strlen($text), 'at' => $at->isFuture() ? now() : $at,
                ]);
            }

            $dropped = self::compact($run);
            RunLog::grew($run);

            return ['stored' => count($valid['events']), 'dropped' => $dropped];
        }, 3);
    }

    /** Drops the oldest lines past the limits of a run and counts them; how many went. */
    private static function compact(AgentRun $run): int
    {
        $rows = AgentRunEvent::query()->where('run_id', $run->id)->orderByDesc('id')->get(['id', 'bytes']);
        $kept = 0;
        $bytes = 0;
        $gone = [];

        foreach ($rows as $row) {
            if ($kept < Protocol::EVENTS_MAX_ROWS && $bytes + $row->bytes <= Protocol::EVENTS_MAX_BYTES) {
                $kept++;
                $bytes += $row->bytes;
            } else {
                $gone[] = $row->id;
            }
        }

        if ($gone !== []) {
            AgentRunEvent::query()->whereKey($gone)->delete();
            $run->forceFill(['events_dropped' => $run->events_dropped + count($gone)])->save();
        }

        return count($gone);
    }
}
