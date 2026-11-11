<?php

namespace App\Search;

use Illuminate\Http\Client\Pool;

/**
 * An engine whose status is a handful of HTTP requests, so the system page can send them in one pool beside the
 * Reverb probe and wait once instead of one after the other (K21). `statusRequests` adds the requests (keys with the
 * engine's own prefix), `statusFrom` reads the answers of the pool (a failed request is a ConnectionException there)
 * as ReportsStatus::status() does: any failure is `down` without tasks.
 */
interface PoolsStatus extends ReportsStatus
{
    public function statusRequests(Pool $pool): void;

    /**
     * @param  array<array-key, mixed>  $responses
     * @return array{search: 'ok'|'down', search_tasks: array{enqueued: int, processing: int, failed_last_day: int}|null}
     */
    public function statusFrom(array $responses): array;
}
