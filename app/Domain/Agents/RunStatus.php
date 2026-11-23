<?php

namespace App\Domain\Agents;

/**
 * The life of a run (spec 7.5): it waits (`queued`, or `waiting` with a reason), runs on a runner (`running`, and
 * `canceling` until the runner stopped the CLI) and ends once.
 */
enum RunStatus: string
{
    case Queued = 'queued';
    case Waiting = 'waiting';
    case Running = 'running';
    case Canceling = 'canceling';
    case Succeeded = 'succeeded';
    case Failed = 'failed';
    case Canceled = 'canceled';
    case TimedOut = 'timed_out';
    case Lost = 'lost';

    public const VALUES = ['queued', 'waiting', 'running', 'canceling', 'succeeded', 'failed', 'canceled', 'timed_out', 'lost'];

    /** The statuses a runner may end a run with (`lost` is werkbuch's). */
    public const REPORTED = ['succeeded', 'failed', 'canceled', 'timed_out'];

    /** Not on a runner yet: a claim may hand it out. */
    public function pending(): bool
    {
        return $this === self::Queued || $this === self::Waiting;
    }

    /** On a runner: it holds a lease and a place. */
    public function busy(): bool
    {
        return $this === self::Running || $this === self::Canceling;
    }

    public function finished(): bool
    {
        return ! $this->pending() && ! $this->busy();
    }

    /** A run that ended without success can be started again (spec 7.2 „Erneut starten“). */
    public function retryable(): bool
    {
        return $this->finished() && $this !== self::Succeeded;
    }
}
