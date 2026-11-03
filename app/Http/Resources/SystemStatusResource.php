<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * The status of the system page (`SystemStatus`, phase plan 8 "REST"): what GetSystemStatus read, with its times as
 * JSON. It asks nothing.
 *
 * @property array{
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
 * } $resource
 */
final class SystemStatusResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $status = $this->resource;

        return [
            'version' => $status['version'],
            'queued_jobs' => $status['queued_jobs'],
            'delayed_jobs' => $status['delayed_jobs'],
            'queues' => array_map(fn (array $queue): array => [...$queue, 'oldest_at' => $queue['oldest_at']?->toJSON()], $status['queues']),
            'failed_jobs' => array_map(fn (array $job): array => [...$job, 'failed_at' => $job['failed_at']->toJSON()], $status['failed_jobs']),
            'failed_jobs_total' => $status['failed_jobs_total'],
            'search' => $status['search'],
            'search_tasks' => $status['search_tasks'],
            'mail_configured' => $status['mail_configured'],
            'live' => $status['live'],
        ];
    }
}
