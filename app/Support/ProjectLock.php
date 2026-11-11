<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\Project;

/**
 * The lock on the row of a project. Every action that changes something a rule over the whole project depends on
 * (members, the identifier, the workflow, the next item number, templates, automations, ranks) takes it first, after
 * the organization and before the items (the order is in CLAUDE.md).
 */
final class ProjectLock
{
    /**
     * The project afresh and under `lockForUpdate`, for the transaction of a change: two changes at the same time (two
     * joins, a removal and a new lead) run one after the other and check what the first one left. A project that is
     * being deleted by now is gone.
     *
     * @throws Problem 404
     */
    public static function lock(Project $project): Project
    {
        $locked = Project::query()->lockForUpdate()->findOrFail($project->id);

        return $locked->deleting_at === null ? $locked : throw Problem::notFound();
    }
}
