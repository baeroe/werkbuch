<?php

namespace Database\Seeders\Demo;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The three projects of the clickdummy with their members (src/api/seed/people.ts, the table „Demo-Rollen“ of its
 * README). Ida and Theo are not in OPS, which is private: the visibility tests rely on that. WEB and OPS work with the
 * default workflow (whichever it is, never one found by name) and Task, Bug and Epic; APP with „Agentur-Freigabe“ and
 * additionally „Kundenwunsch“. Task is the default type of all three. Names, descriptions and the catalog entries come
 * in the language of the demo (DemoTexts). Needs the CatalogSeeder before it.
 */
class ProjectsSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(RoleAssignments $roles): void
    {
        $projects = [
            'WEB' => [
                'lead' => 'ida',
                'visibility' => ProjectVisibility::Public,
                'workflow' => null, // the default workflow
                'types' => ['task', 'bug', 'epic'],
                'members' => ['mara' => ProjectRole::Admin, 'ida' => ProjectRole::Admin, 'jonas' => ProjectRole::Member, 'lene' => ProjectRole::Member, 'kira' => ProjectRole::Member, 'theo' => ProjectRole::Viewer],
            ],
            'APP' => [
                'lead' => 'theo',
                'visibility' => ProjectVisibility::Public,
                'workflow' => 'agency',
                'types' => ['task', 'bug', 'epic', 'wish'],
                'members' => ['theo' => ProjectRole::Admin, 'mara' => ProjectRole::Member, 'jonas' => ProjectRole::Member, 'lene' => ProjectRole::Member],
            ],
            'OPS' => [
                'lead' => 'jonas',
                'visibility' => ProjectVisibility::Private,
                'workflow' => null, // the default workflow
                'types' => ['task', 'bug', 'epic'],
                'members' => ['jonas' => ProjectRole::Admin, 'mara' => ProjectRole::Member, 'kira' => ProjectRole::Member],
            ],
        ];

        $account = fn (string $handle): User => User::query()->where('handle', $handle)->sole();
        $workflows = Workflow::query()->pluck('id', 'name');
        $names = WorkItemType::query()->pluck('id', 'name');
        $type = fn (string $key): string => $names[DemoTexts::get("catalog.type.{$key}.name")];

        foreach ($projects as $identifier => $data) {
            // firstOrNew: workflow and types are set only when the project is created; later, items sit on the states
            // of the workflow an admin may have chosen, and a second run must not put another workflow under them
            $project = Project::query()->firstOrNew(['identifier' => $identifier]);
            $project->fill([
                'name' => DemoTexts::get("project.{$identifier}.name"),
                'description' => DemoTexts::get("project.{$identifier}.description"),
                'lead_id' => $account($data['lead'])->id,
                'visibility' => $data['visibility'],
            ]);

            if (! $project->exists) {
                $project->fill([
                    'workflow_id' => $data['workflow'] === null ? Workflow::default()->id : $workflows[DemoTexts::get("catalog.workflow.{$data['workflow']}.name")],
                    'default_type_id' => $type('task'),
                ]);
            }

            $project->save();

            if ($project->wasRecentlyCreated) {
                $project->types()->sync(array_map($type, $data['types']));
            }

            foreach ($data['members'] as $handle => $role) {
                $roles->setProjectRole($account($handle), $project, $role);
            }
        }
    }
}
