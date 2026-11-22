<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Support\Actor;
use App\Support\Includes;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * One project the account sees. REST hands over the bound model; a page hands over the reference from its address (ULID,
 * identifier or former identifier). A project that does not exist and one the account does not see are the same 404.
 * Asked for by a former identifier, the project says so (`resolved_by_former_identifier`): the caller redirects to the
 * current identifier and decides nothing itself (P32).
 *
 * `include=types` embeds the types the project switched on, whole as `GET /work-item-types/{id}` gives them (name,
 * `is_epic`, the properties they ask for), in catalog order (A471): what an agent needs to pick `type_id` in a project
 * without items.
 */
final class GetProject
{
    use AsAction;

    /** What a project can embed (`include`). */
    public const INCLUDES = ['types'];

    /**
     * @param  array<array-key, mixed>  $include  names out of INCLUDES (blanks around them and empty ones are ignored)
     *
     * @throws Problem 404
     * @throws ValidationException at `include` for anything else
     */
    public function handle(Actor $actor, Project|string $project, array $include = []): Project
    {
        $reference = is_string($project) ? $project : null;
        $project = is_string($project) ? (Project::findByReference($project) ?? throw Problem::notFound()) : $project;

        Authorize::check($actor, 'view', $project);

        $include = Includes::read($include, self::INCLUDES);

        $project->embeds_types = in_array('types', $include, true);
        $project->load($project->embeds_types ? ['types', 'types.typeProperties'] : ['types:work_item_types.id']);
        $project->resolved_by_former_identifier = $reference !== null && $project->identifiers()->where('identifier', strtoupper($reference))->exists();

        return $project;
    }
}
