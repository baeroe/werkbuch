<?php

namespace Database\Seeders\Demo;

use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Models\Automation;
use App\Models\Project;
use App\Models\WorkflowState;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The automations of the three projects in the clickdummy (src/api/seed/config.ts; `AutomationsSeederTest` reads that
 * file): WEB Auto-Archive after 30 days and the assignee on start, APP Auto-Close after 90 days into its Cancelled (the
 * first Canceled state of the workflow the project has) and closing the parent, OPS all off. `link_references` is not in the
 * file (A446) and is on in all three (A452). Every project gets a row for each of the five keys, with the settings the key starts with. Auto-Close stays off in a workflow without a
 * Canceled state. Written directly, without events (A86).
 *
 * Safe to run again (like K13): it creates the rows whose (project, key) is missing and never changes one that exists,
 * so what an admin switched stays so. The E2eSeeder switches them all off afterwards (K9).
 */
class AutomationsSeeder extends Seeder
{
    use WithoutModelEvents;

    /** The keys each project switches on. */
    private const ENABLED = [
        'WEB' => [AutomationKey::AutoArchive, AutomationKey::AssignOnStart, AutomationKey::LinkReferences],
        'APP' => [AutomationKey::AutoClose, AutomationKey::CloseParent, AutomationKey::LinkReferences],
        'OPS' => [AutomationKey::LinkReferences],
    ];

    public function run(): void
    {
        foreach (self::ENABLED as $identifier => $enabled) {
            $project = Project::query()->where('identifier', $identifier)->sole();
            $cancelled = WorkflowState::query()->where('workflow_id', $project->workflow_id)->where('category', StateCategory::Canceled)
                ->orderBy('position')->orderBy('id')->value('id');

            foreach (AutomationKey::cases() as $key) {
                $settings = $key === AutomationKey::AutoClose ? [...$key->defaults(), 'state_id' => $cancelled] : $key->defaults();
                Automation::query()->firstOrCreate(['project_id' => $project->id, 'key' => $key], [
                    'enabled' => in_array($key, $enabled, true) && ($key !== AutomationKey::AutoClose || $cancelled !== null),
                    'settings' => $settings,
                ]);
            }
        }
    }
}
