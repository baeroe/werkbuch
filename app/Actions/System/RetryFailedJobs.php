<?php

namespace App\Actions\System;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Organization;
use App\Support\Actor;
use Illuminate\Queue\Failed\FailedJobProviderInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * "Erneut versuchen" on the system page (A287): puts the failed jobs named in `ids` (UUIDs as the page lists them, any
 * case; 1 to MAX_IDS; unknown ones are passed over), or all of them without `ids`, back into the queue they failed in,
 * with their attempts reset as `queue:retry` does, and forgets them. Their rows are read under a lock, so two admins
 * who retry at once put each job back once. All of them go in blocks of BLOCK, each in its own transaction. One event
 * `system.failed_jobs_retried` (subject the organization, `meta.count`, `meta.ids`) per block that put something back;
 * answers how many in all.
 */
final class RetryFailedJobs
{
    use AsAction;

    public const MAX_IDS = 100;

    /** How many failed jobs one transaction puts back when all of them go. */
    public const BLOCK = 500;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): int
    {
        Authorize::check($actor, 'viewSystem', Organization::class);

        // every way ids can be wrong gets the one sentence at `ids`
        $invalid = Validator::make($input, [
            'ids' => ['nullable', 'list', 'min:1', 'max:'.self::MAX_IDS],
            'ids.*' => ['string', 'uuid'],
        ])->fails();
        if ($invalid) {
            throw ValidationException::withMessages(['ids' => [__('field.ids.failed_jobs', ['max' => self::MAX_IDS])]]);
        }

        /** @var list<string>|null $ids */
        $ids = isset($input['ids']) ? array_map(strtolower(...), $input['ids']) : null;

        if ($ids !== null) {
            return $this->block($actor, $ids);
        }

        // all of them: block after block, so no transaction holds thousands of rows (T11-M1)
        $total = 0;
        do {
            $total += $retried = $this->block($actor, null);
        } while ($retried === self::BLOCK);

        return $total;
    }

    /**
     * Puts back the named jobs, or the first BLOCK of all of them, in one transaction with one event.
     *
     * @param  list<string>|null  $ids
     */
    private function block(Actor $actor, ?array $ids): int
    {
        return DB::transaction(function () use ($actor, $ids): int {
            $jobs = DB::connection(config('queue.failed.database'))->table(config('queue.failed.table'))
                ->when($ids !== null, fn ($query) => $query->whereIn('uuid', $ids), fn ($query) => $query->limit(self::BLOCK))
                ->orderBy('id')->lockForUpdate()
                ->get(['uuid', 'connection', 'queue', 'payload']);

            if ($jobs->isEmpty()) {
                return 0;
            }

            $failer = app(FailedJobProviderInterface::class);
            foreach ($jobs as $job) {
                Queue::connection((string) $job->connection)->pushRaw($this->freshAttempts((string) $job->payload), (string) $job->queue);
                $failer->forget((string) $job->uuid);
            }

            $uuids = $jobs->map(fn (object $job): string => (string) $job->uuid)->all();
            EventRecorder::record(EventType::SystemFailedJobsRetried, $actor, Organization::current(), null, null, [
                'count' => count($uuids), 'ids' => $uuids,
            ]);

            return count($uuids);
        });
    }

    /** The payload with its attempts back at 0, as `queue:retry` writes it. */
    private function freshAttempts(string $payload): string
    {
        $decoded = json_decode($payload, true);
        if (is_array($decoded) && isset($decoded['attempts'])) {
            $decoded['attempts'] = 0;

            return (string) json_encode($decoded);
        }

        return $payload;
    }
}
