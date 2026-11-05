<?php

namespace App\Domain\Automations;

use App\Domain\Workflow\StateCategory;

/**
 * "Assign on start": a person who moves an item without an assignee into a started state takes it.
 */
final class AssignOnStartRule
{
    public static function applies(bool $actorIsPerson, ?string $assigneeId, StateCategory $from, StateCategory $to): bool
    {
        return $actorIsPerson
            && $assigneeId === null
            && $from !== StateCategory::Started
            && $to === StateCategory::Started;
    }
}
