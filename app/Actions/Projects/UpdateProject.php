<?php

namespace App\Actions\Projects;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Support\Actor;
use App\Support\ImageInput;
use App\Support\MemberInput;
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
 * With an identifier in the input, the change takes the lock on the organization row first and checks under it: no
 * index spans current and former identifiers, so changes of identifiers run one at a time. Then it locks the project
 * row and reads the project afresh: two changes of one project run one after the other, the second from what the first
 * left, and the new lead cannot be removed from the project while it is checked to be a member. A project that is
 * being deleted is gone (404).
 */
final class UpdateProject
{
    use AsAction;

    /**
     * @param  array<string, mixed>  $input
     *
     * @throws ValidationException
     * @throws Problem 404 for a project that is being deleted
     */
    public function handle(Actor $actor, Project $project, array $input): Project
    {
        Authorize::check($actor, 'update', $project);

        $input = ProjectInput::normalize($input);

        $changed = DB::transaction(function () use ($actor, $project, $input): bool {
            if (array_key_exists('identifier', $input)) {
                // identifiers are unique across two tables: one change of identifiers at a time, checked under the lock
                Organization::query()->lockForUpdate()->sole();
            }

            // one change of the project at a time, each from what the one before left (the old values of the event, the
            // former identifier); the lead must stay a member: a removal of the new lead waits for this change
            MemberInput::lock($project);
            $project->refresh();

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
