<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One project the account sees. REST hands over the bound model; a page hands over the reference from its address (ULID,
 * identifier or former identifier). A project that does not exist and one the account does not see are the same 404.
 * Asked for by a former identifier, the project says so (`resolved_by_former_identifier`): the caller redirects to the
 * current identifier and decides nothing itself (P32).
 */
final class GetProject
{
    use AsAction;

    /**
     * @throws Problem 404
     */
    public function handle(Actor $actor, Project|string $project): Project
    {
        $reference = is_string($project) ? $project : null;
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;

        Authorize::check($actor, 'view', $project);

        $project->load('types:work_item_types.id');
        $project->resolved_by_former_identifier = $reference !== null && $project->identifiers()->where('identifier', strtoupper($reference))->exists();

        return $project;
    }
}
