<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Enums\ProjectVisibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use App\Support\Actor;
use App\Support\ImageInput;
use App\Support\ProjectInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a project (every account with `project.create`): name, identifier, optionally description, picture,
 * visibility (public unless said otherwise) and lead (the actor unless said otherwise; an active person, P17). The
 * actor becomes its admin, another lead a member. Workflow and types come with Phase 3 (until then they are ignored).
 * The identifier is checked under the lock on the organization row, like every change of identifiers.
 */
final class CreateProject
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @param  array<string, mixed>  $input  `name`, `identifier`, `description`, `image_url`, `visibility`, `lead_id`
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): Project
    {
        Authorize::check($actor, 'create', Project::class);

        $input = ProjectInput::normalize($input);
        $input['lead_id'] ??= $actor->user->id;

        $project = DB::transaction(function () use ($actor, $input): Project {
            // identifiers are unique across two tables: one change of identifiers at a time, checked under the lock
            Organization::query()->lockForUpdate()->sole();

            $valid = Validator::make($input, [
                'name' => ['required', 'string', 'max:'.ProjectInput::NAME_MAX],
                'identifier' => ProjectInput::identifier(),
                'description' => ['nullable', 'string', 'max:'.ProjectInput::DESCRIPTION_MAX],
                'image_url' => ImageInput::rules(),
                'visibility' => ['sometimes', ...ProjectInput::visibility()],
                'lead_id' => ['required', 'string', ProjectInput::lead()],
            ], ProjectInput::messages())->validate();

            $project = Project::query()->create([
                'identifier' => $valid['identifier'],
                'name' => $valid['name'],
                'description' => $valid['description'] ?? '',
                'lead_id' => $valid['lead_id'],
                'visibility' => $valid['visibility'] ?? ProjectVisibility::Public->value,
                'next_number' => 0,
            ]);

            $this->roles->setProjectRole($actor->user, $project, ProjectRole::Admin);

            if ($project->lead_id !== $actor->user->id) {
                $this->roles->setProjectRole(User::query()->findOrFail($project->lead_id), $project, ProjectRole::Member);
            }

            ImageInput::apply($project, 'image', $valid['image_url'] ?? null, null);
            EventRecorder::record(EventType::ProjectCreated, $actor, $project, $project, ['identifier' => ['old' => null, 'new' => $project->identifier]]);

            return $project;
        });

        // the new project and the new memberships count from the next check of this request on (P33)
        Visibility::forget();

        return $project;
    }
}
