<?php

namespace App\Jobs;

use App\Actions\Projects\PurgeProject as PurgeProjectAction;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Removes a deleted project on the queue `bulk` (DeleteProject puts it there after the commit). A project that is gone
 * already (an earlier attempt finished) leaves nothing to do.
 */
final class PurgeProject implements ShouldQueue
{
    use Queueable;

    public int $tries = 5;

    /** @var list<int> */
    public array $backoff = [10, 60, 300];

    public function __construct(public string $projectId, public string $actorId)
    {
        $this->onQueue('bulk');
    }

    public function handle(): void
    {
        $project = Project::query()->find($this->projectId);

        if ($project === null) {
            return;
        }

        PurgeProjectAction::run(Actor::system(User::query()->findOrFail($this->actorId), 'project_deleted'), $project);
    }
}
