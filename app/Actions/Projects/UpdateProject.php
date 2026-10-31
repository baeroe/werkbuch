<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Actor;
use App\Support\ImageInput;
use App\Support\ProjectInput;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The settings of a project (its admins, also while it is archived): name, description, picture, visibility, lead (an
 * active person who is a member) and identifier. A new identifier keeps the old one as a former identifier, which goes
 * on resolving and stays reserved; coming back to a former identifier of the same project ends that entry (spec 4.4).
 * Only the fields the input names change; `project.updated` lists what really changed, nothing changed means no event.
 */
final class UpdateProject
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, Project $project, array $input): Project
    {
        Authorize::check($actor, 'update', $project);

        $input = ProjectInput::normalize($input);
        $image = ImageInput::url($project, 'image');

        $valid = Validator::make($input, [
            'name' => ['sometimes', 'required', 'string', 'max:'.ProjectInput::NAME_MAX],
            'identifier' => ['sometimes', ...ProjectInput::identifier($project)],
            'description' => ['sometimes', 'nullable', 'string', 'max:'.ProjectInput::DESCRIPTION_MAX],
            'image_url' => ['sometimes', ...ImageInput::rules($image)],
            'visibility' => ['sometimes', ...ProjectInput::visibility()],
            'lead_id' => [
                'sometimes', 'bail', 'required', 'string', ProjectInput::lead(),
                function (string $attribute, string $value, Closure $fail) use ($project): void {
                    if (! ProjectMember::query()->where('project_id', $project->id)->where('user_id', $value)->exists()) {
                        $fail(__('field.lead.not_member'));
                    }
                },
            ],
        ], ProjectInput::messages())->validate();

        if (array_key_exists('description', $valid)) {
            $valid['description'] ??= '';
        }

        $current = [
            'name' => $project->name,
            'identifier' => $project->identifier,
            'description' => $project->description,
            'visibility' => $project->visibility->value,
            'lead_id' => $project->lead_id,
        ];

        $changes = [];

        foreach ($current as $field => $old) {
            if (array_key_exists($field, $valid) && $valid[$field] !== $old) {
                $changes[$field] = ['old' => $old, 'new' => $valid[$field]];
            }
        }

        $changed = DB::transaction(function () use ($actor, $project, $valid, $image, $changes): bool {
            if (isset($changes['identifier'])) {
                // back to a former identifier of its own: that entry ends; the identifier it leaves stays reserved
                $project->identifiers()->where('identifier', $changes['identifier']['new'])->delete();
                $project->identifiers()->create(['identifier' => $changes['identifier']['old']]);
            }

            if (array_key_exists('image_url', $valid)) {
                $changes += array_filter(['image_url' => ImageInput::apply($project, 'image', $valid['image_url'], $image)]);
            }

            if ($changes === []) {
                return false;
            }

            $project->update(array_map(fn (array $change) => $change['new'], array_diff_key($changes, ['image_url' => true])));
            EventRecorder::record(EventType::ProjectUpdated, $actor, $project, $project, $changes);

            return true;
        });

        if ($changed) {
            // who sees the project (visibility) counts from the next check of this request on (P33)
            Visibility::forget();
        }

        return $project;
    }
}
