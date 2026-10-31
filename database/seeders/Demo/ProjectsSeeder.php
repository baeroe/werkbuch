<?php

namespace Database\Seeders\Demo;

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The three projects of the clickdummy with their members (src/api/seed/people.ts, the table „Demo-Rollen“ of its
 * README). Ida and Theo are not in OPS, which is private: the visibility tests rely on that. WEB and OPS work with the
 * default workflow and Task, Bug and Epic; APP with „Agentur-Freigabe“ and additionally „Kundenwunsch“. Task is the
 * default type of all three. Needs the CatalogSeeder before it.
 */
class ProjectsSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(RoleAssignments $roles): void
    {
        $projects = [
            'WEB' => [
                'name' => 'Website-Relaunch',
                'description' => 'Neuer Webauftritt: Struktur, Gestaltung, Technik und der Umzug auf den neuen Server.',
                'lead' => 'ida',
                'visibility' => ProjectVisibility::Public,
                'workflow' => 'Standard',
                'types' => ['Task', 'Bug', 'Epic'],
                'members' => ['mara' => ProjectRole::Admin, 'ida' => ProjectRole::Admin, 'jonas' => ProjectRole::Member, 'lene' => ProjectRole::Member, 'kira' => ProjectRole::Member, 'theo' => ProjectRole::Viewer],
            ],
            'APP' => [
                'name' => 'Kunden-App',
                'description' => 'Die App für Bestellungen und Rückfragen. Version 2.0 ist in der Beta.',
                'lead' => 'theo',
                'visibility' => ProjectVisibility::Public,
                'workflow' => 'Agentur-Freigabe',
                'types' => ['Task', 'Bug', 'Epic', 'Kundenwunsch'],
                'members' => ['theo' => ProjectRole::Admin, 'mara' => ProjectRole::Member, 'jonas' => ProjectRole::Member, 'lene' => ProjectRole::Member],
            ],
            'OPS' => [
                'name' => 'Infrastruktur',
                'description' => 'Server, Betrieb und Backups. Nur für das Technik-Team.',
                'lead' => 'jonas',
                'visibility' => ProjectVisibility::Private,
                'workflow' => 'Standard',
                'types' => ['Task', 'Bug', 'Epic'],
                'members' => ['jonas' => ProjectRole::Admin, 'mara' => ProjectRole::Member, 'kira' => ProjectRole::Member],
            ],
        ];

        $account = fn (string $handle): User => User::query()->where('handle', $handle)->sole();
        $workflows = Workflow::query()->pluck('id', 'name');
        $types = WorkItemType::query()->pluck('id', 'name');

        foreach ($projects as $identifier => $data) {
            $project = Project::updateOrCreate(['identifier' => $identifier], [
                'name' => $data['name'],
                'description' => $data['description'],
                'lead_id' => $account($data['lead'])->id,
                'visibility' => $data['visibility'],
                'workflow_id' => $workflows[$data['workflow']],
                'default_type_id' => $types['Task'],
            ]);
            $project->types()->sync(array_map(fn (string $name): string => $types[$name], $data['types']));

            foreach ($data['members'] as $handle => $role) {
                $roles->setProjectRole($account($handle), $project, $role);
            }
        }
    }
}
