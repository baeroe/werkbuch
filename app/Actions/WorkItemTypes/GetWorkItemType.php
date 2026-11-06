<?php

namespace App\Actions\WorkItemTypes;

use App\Models\WorkItemType;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One type of work item with its properties, as the list shows it (archived ones too). Every account reads it. The
 * route binds it by ULID in any case (A392).
 */
final class GetWorkItemType
{
    use AsAction;

    public function handle(Actor $actor, WorkItemType $type): WorkItemType
    {
        return $type->load('typeProperties');
    }
}
