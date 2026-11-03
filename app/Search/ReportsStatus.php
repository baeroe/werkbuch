<?php

namespace App\Search;

/**
 * An engine that says how it is (the system page, K15): whether it answers and how many of its tasks for the indexes of
 * this instance wait, run or failed in the last 24 hours. Any failure to ask is `down` without tasks, never an exception.
 */
interface ReportsStatus
{
    /**
     * @return array{search: 'ok'|'down', search_tasks: array{enqueued: int, processing: int, failed_last_day: int}|null}
     */
    public function status(): array;
}
