<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Enums\ProjectVisibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\ImageInput;
use App\Support\ProjectInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a project (every account with `project.create`): name, identifier, optionally description, picture,
 * visibility (public unless said otherwise), lead (the actor unless said otherwise; an active person, P17), workflow
 * (the default workflow unless said otherwise), the switched-on types (every active type unless said otherwise, P10;
 * each one active) and the default type (the first of them unless said otherwise; one of them). The actor becomes its
 * admin, another lead a member. Everything is checked under the catalog lock (the organization row), like every change
 * of identifiers: no workflow or type goes while the project gets it.
 */
final class CreateProject
{
    use AsAction;

    public function __construct(private readonly RoleAssignments $roles) {}

    /**
     * @param  array<string, mixed>  $input  `name`, `identifier`, `description`, `image_url`, `visibility`, `lead_id`, `workflow_id`, `enabled_type_ids`, `default_type_id`
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): Project
    {
        Authorize::check($actor, 'create', Project::class);

        $input = ProjectInput::normalize($input);
        $input['lead_id'] ??= $actor->user->id;

        $project = DB::transaction(function () use ($actor, $input): Project {
            // identifiers are unique across two tables, and the workflow and the types must stay: one change of identifiers
            // and of the catalog at a time, checked under the lock
            CatalogLock::take();

            $input['workflow_id'] ??= Workflow::default()->id;
            $input['enabled_type_ids'] ??= WorkItemType::query()->whereNull('archived_at')->orderBy('id')->pluck('id')->all();

            $valid = Validator::make($input, [
                'name' => ['required', 'string', 'max:'.ProjectInput::NAME_MAX],
                'identifier' => ProjectInput::identifier(),
                'description' => ['nullable', 'string', 'max:'.ProjectInput::DESCRIPTION_MAX],
                'image_url' => ImageInput::rules(),
                'visibility' => ['sometimes', ...ProjectInput::visibility()],
                'lead_id' => ['required', 'string', ProjectInput::lead()],
                'workflow_id' => ProjectInput::workflow(),
                'enabled_type_ids' => ProjectInput::types(),
                'default_type_id' => ['nullable', 'string'],
            ], ProjectInput::messages())->validate();

            [$types, $defaultType] = ProjectInput::enabledTypes($valid['enabled_type_ids'], $valid['default_type_id'] ?? null);

            $project = Project::query()->create([
                'identifier' => $valid['identifier'],
                'name' => $valid['name'],
                'description' => $valid['description'] ?? '',
                'lead_id' => $valid['lead_id'],
                'visibility' => $valid['visibility'] ?? ProjectVisibility::Public->value,
                'workflow_id' => $valid['workflow_id'],
                'default_type_id' => $defaultType,
                'next_number' => 0,
            ]);
            $project->types()->sync($types);

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
