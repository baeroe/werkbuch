<?php

namespace App\Live;

use App\Models\WorkItem;
use App\Models\WorkItemLink;
use Illuminate\Support\Facades\DB;

/**
 * Tells the project of an item that the checks of a PR linked to it changed (`work_item.checks_changed`, WEBU-28, A648):
 * check runs, workflow runs and commit statuses come without an event (SyncChecks, LoadChecks), and without a message
 * the item would show the CI of before until something else loads it again. Once per item and call, after the commit
 * (DB::afterCommit), only through Broadcasts (never throws).
 */
final class ChecksChanged
{
    /**
     * @param  list<WorkItemLink>  $links  the links whose checks changed
     */
    public static function tell(array $links): void
    {
        $items = array_values(array_unique(array_map(fn (WorkItemLink $link) => $link->work_item_id, $links)));
        if ($items === []) {
            return;
        }

        /** @var array<string, string> $projects */
        $projects = WorkItem::query()->whereKey($items)->pluck('project_id', 'id')->all();
        DB::afterCommit(function () use ($projects): void {
            foreach ($projects as $item => $project) {
                Broadcasts::send(LiveMessage::checksChanged((string) $item, $project));
            }
        });
    }
}
