<?php

namespace App\Actions\Workflows;

use App\Access\Authorize;
use App\Access\Visibility;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\Ids;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * How many work items stand in each state (for the mapping of states, spec 4.5), archived ones included; states
 * without items are left out. Either of one `project` (a reference: ULID, identifier or former identifier; one the
 * account does not see is 404) or of a `workflow` (its ULID), counted over the projects of the workflow the account
 * sees.
 */
final class ListStateUsage
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $query  `project` or `workflow`
     * @return list<array{state_id: string, items: int}>
     *
     * @throws ValidationException
     * @throws Problem 404 for a project the account does not see
     */
    public function handle(Actor $actor, array $query): array
    {
        if (($query['project'] ?? null) !== null) {
            if (($query['workflow'] ?? null) !== null) {
                throw ValidationException::withMessages(['workflow' => __('field.state_usage.either')]);
            }

            $project = (is_string($query['project']) ? Project::findByReference($query['project']) : null) ?? throw Problem::notFound();
            Authorize::check($actor, 'view', $project);
            $projectIds = [$project->id];
        } else {
            /** @var array{workflow: string} $valid */
            $valid = Validator::make(['workflow' => Ids::normalize($query['workflow'] ?? null)], [
                'workflow' => ['bail', 'required', 'string', 'ulid', Rule::exists('workflows', 'id')],
            ], [
                'workflow.required' => __('field.state_usage.either'),
                'workflow.string' => __('field.workflow_id.unknown'),
                'workflow.ulid' => __('field.workflow_id.unknown'),
                'workflow.exists' => __('field.workflow_id.unknown'),
            ])->validate();

            /** @var list<string> $projectIds */
            $projectIds = Project::query()->where('workflow_id', $valid['workflow'])
                ->whereIn('id', Visibility::projectIds($actor->user))->pluck('id')->all();
        }

        $usage = [];

        foreach (self::counts($projectIds) as $state => $items) {
            $usage[] = ['state_id' => $state, 'items' => $items];
        }

        return $usage;
    }

    /**
     * The items per state of the projects (archived ones included, projects in deletion too), by state id.
     *
     * @param  list<string>  $projectIds
     * @return array<string, int>
     */
    public static function counts(array $projectIds): array
    {
        $counts = [];

        foreach (WorkItem::query()->toBase()->whereIn('project_id', $projectIds)->select('state_id')->selectRaw('count(*) as items')
            ->groupBy('state_id')->orderBy('state_id')->get() as $row) {
            $counts[(string) $row->state_id] = (int) $row->items;
        }

        return $counts;
    }
}
