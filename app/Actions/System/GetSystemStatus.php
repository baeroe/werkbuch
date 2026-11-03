<?php

namespace App\Actions\System;

use App\Access\Authorize;
use App\Models\Organization;
use App\Search\ReportsStatus;
use App\Support\Actor;
use App\Support\MailSetup;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Laravel\Scout\EngineManager;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * What the system page shows its org admins (spec 5.2, A287): the version; per queue of `werkbuch.queues` the jobs that
 * are due and not being worked (`pending`) and since when the oldest of them is due (`oldest_at`), `queued_jobs` their
 * sum; jobs due later (mail collections, `delayed_jobs`) are no backlog. The newest FAILED_SHOWN failed jobs with the
 * first line of their error (at most ERROR_MAX characters) and how many there are; Meilisearch over the engine
 * (ReportsStatus, `down` for an engine that cannot say, K15); whether mail can go out (MailSetup); and Reverb: `off`
 * when it is not the broadcaster, else whether its `/up` answers within 2 s. It reads the tables of the database queue
 * (`queue.connections.database`) and of the failed jobs (`queue.failed`, driver `database-uuids`).
 */
final class GetSystemStatus
{
    use AsAction;

    public const FAILED_SHOWN = 50;

    public const ERROR_MAX = 300;

    /**
     * @return array{
     *     version: string,
     *     queued_jobs: int,
     *     delayed_jobs: int,
     *     queues: list<array{queue: string, pending: int, oldest_at: Carbon|null}>,
     *     failed_jobs: list<array{id: string, queue: string, job: string, error: string, failed_at: Carbon}>,
     *     failed_jobs_total: int,
     *     search: 'ok'|'down',
     *     search_tasks: array{enqueued: int, processing: int, failed_last_day: int}|null,
     *     mail_configured: bool,
     *     live: 'ok'|'down'|'off',
     * }
     */
    public function handle(Actor $actor): array
    {
        Authorize::check($actor, 'viewSystem', Organization::class);

        $queues = $this->queues();
        $failed = DB::connection(config('queue.failed.database'))->table(config('queue.failed.table'));

        $engine = app(EngineManager::class)->engine();

        return [
            'version' => (string) config('werkbuch.version'),
            'queued_jobs' => array_sum(array_column($queues, 'pending')),
            'delayed_jobs' => $this->jobs()->where('available_at', '>', now()->getTimestamp())->count(),
            'queues' => $queues,
            'failed_jobs' => $this->failedJobs(),
            'failed_jobs_total' => $failed->count(),
            ...($engine instanceof ReportsStatus ? $engine->status() : ['search' => 'down', 'search_tasks' => null]),
            'mail_configured' => MailSetup::configured(),
            'live' => $this->live(),
        ];
    }

    /**
     * @return list<array{queue: string, pending: int, oldest_at: Carbon|null}>
     */
    private function queues(): array
    {
        $due = $this->jobs()->where('available_at', '<=', now()->getTimestamp())
            ->groupBy('queue')->selectRaw('queue, count(*) as pending, min(available_at) as oldest')
            ->get()->keyBy('queue');

        /** @var list<string> $names */
        $names = config('werkbuch.queues');

        return array_map(fn (string $queue): array => [
            'queue' => $queue,
            'pending' => (int) ($due[$queue]->pending ?? 0),
            'oldest_at' => isset($due[$queue]) ? Carbon::createFromTimestamp((int) $due[$queue]->oldest, 'UTC') : null,
        ], $names);
    }

    /** The jobs of the database queue that no worker holds. */
    private function jobs(): Builder
    {
        return DB::connection(config('queue.connections.database.connection'))
            ->table(config('queue.connections.database.table'))
            ->whereNull('reserved_at');
    }

    /**
     * @return list<array{id: string, queue: string, job: string, error: string, failed_at: Carbon}>
     */
    private function failedJobs(): array
    {
        return array_values(DB::connection(config('queue.failed.database'))->table(config('queue.failed.table'))
            ->orderByDesc('failed_at')->orderByDesc('id')->limit(self::FAILED_SHOWN)
            ->get(['uuid', 'queue', 'payload', 'exception', 'failed_at'])
            ->map(fn (object $job): array => [
                'id' => (string) $job->uuid,
                'queue' => (string) $job->queue,
                'job' => (string) (json_decode((string) $job->payload, true)['displayName'] ?? ''),
                'error' => mb_substr(Str::before((string) $job->exception, "\n"), 0, self::ERROR_MAX),
                'failed_at' => Carbon::parse((string) $job->failed_at, 'UTC'),
            ])->all());
    }

    /** @return 'ok'|'down'|'off' */
    private function live(): string
    {
        if (config('broadcasting.default') !== 'reverb') {
            return 'off';
        }

        $options = (array) config('broadcasting.connections.reverb.options');

        try {
            return Http::connectTimeout(2)->timeout(2)
                ->get(sprintf('%s://%s:%d/up', $options['scheme'] ?? 'https', $options['host'] ?? '', (int) ($options['port'] ?? 443)))
                ->successful() ? 'ok' : 'down';
        } catch (ConnectionException) {
            return 'down';
        }
    }
}
