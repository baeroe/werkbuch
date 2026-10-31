<?php

namespace App\Domain\Workflow;

/**
 * The category of a workflow state (spec 4.5): what the state means, whatever it is called.
 */
enum StateCategory: string
{
    case Backlog = 'backlog';
    case Unstarted = 'unstarted';
    case Started = 'started';
    case Completed = 'completed';
    case Canceled = 'canceled';

    /** The categories from left to right: how boards and lists arrange them. */
    public const ORDER = [self::Backlog, self::Unstarted, self::Started, self::Completed, self::Canceled];

    /** Completed and canceled items are closed; everything else is open. */
    public function isClosed(): bool
    {
        return $this === self::Completed || $this === self::Canceled;
    }
}
