<?php

use App\Domain\Automations\AutomationKey;
use App\Domain\Workflow\StateCategory;
use App\Models\Automation;
use App\Models\Event;
use App\Models\Project;
use App\Models\Workflow;
use App\Models\WorkflowState;
use Database\Seeders\Demo\AutomationsSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// the demo files of the AttachmentsSeeder land on the disk `local`
beforeEach(fn () => Storage::fake('local'));

/**
 * The automations of the three projects in the clickdummy (src/api/seed/config.ts), parsed from the file: which keys
 * each project switches on, the Canceled state of Auto-Close (`std_cancelled` or `app_cancelled`) and the days the
 * two nightly ones start with.
 *
 * @return array{projects: array<string, array{on: list<string>, cancelled: string}>, days: array<string, int>}
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/config.ts'));
    preg_match_all("/\\.\\.\\.automations\\('p_(\\w+)', '\\w+', \\{([^}]*)\\}, '(\\w+)'\\)/", $source, $calls, PREG_SET_ORDER);
    preg_match_all("/key: '(\\w+)', enabled: [^,]+, settings: \\{ days: (\\d+)/", $source, $days, PREG_SET_ORDER);

    $projects = [];
    foreach ($calls as [, $project, $enabled, $cancelled]) {
        preg_match_all('/(\w+): true/', $enabled, $on);
        $projects[strtoupper($project)] = ['on' => $on[1], 'cancelled' => $cancelled];
    }

    return ['projects' => $projects, 'days' => collect($days)->mapWithKeys(fn (array $row) => [$row[1] => (int) $row[2]])->all()];
};

$snapshot = fn (): array => DB::table('automations')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all();

it('seeds the automations of the three projects like the clickdummy', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    ['projects' => $projects, 'days' => $days] = $clickdummy();
    $cancelled = fn (Workflow $workflow) => WorkflowState::query()->where('workflow_id', $workflow->id)->where('name', 'Cancelled')->value('id');
    $states = [
        'std_cancelled' => $cancelled(Workflow::default()),
        'app_cancelled' => $cancelled(Workflow::query()->where('name', 'Agentur-Freigabe')->sole()),
    ];

    expect($projects)->toHaveCount(3)
        ->and($days)->toBe(['auto_archive' => 30, 'auto_close' => 90])
        ->and(Automation::query()->count())->toBe(12)
        ->and(Event::query()->where('type', 'like', 'automation.%')->count())->toBe(0);

    foreach ($projects as $identifier => $row) {
        $stored = Automation::query()->where('project_id', Project::query()->where('identifier', $identifier)->value('id'))->get()
            ->mapWithKeys(fn (Automation $automation) => [$automation->key->value => [$automation->enabled, $automation->settings]])->all();

        expect($stored)->toEqual([
            'auto_archive' => [in_array('auto_archive', $row['on'], true), ['days' => $days['auto_archive']]],
            'auto_close' => [in_array('auto_close', $row['on'], true), ['days' => $days['auto_close'], 'state_id' => $states[$row['cancelled']]]],
            'close_parent' => [in_array('close_parent', $row['on'], true), []],
            'assign_on_start' => [in_array('assign_on_start', $row['on'], true), []],
        ], $identifier);
    }

    // WEB: Auto-Archive and assignee on start; APP: Auto-Close into its Cancelled and close the parent; OPS: all off
    expect(Automation::query()->where('enabled', true)->with('project')->get()->map(fn (Automation $a) => $a->project->identifier.' '.$a->key->value)->sort()->values()->all())
        ->toBe(['APP auto_close', 'APP close_parent', 'WEB assign_on_start', 'WEB auto_archive']);
});

it('changes nothing on a second run and keeps what an admin switched', function () use ($snapshot) {
    $this->seed(DemoSeeder::class);
    $before = $snapshot();

    (new AutomationsSeeder)->run();
    expect($snapshot())->toBe($before);

    // switched off by an admin: stays off; a row that is gone comes back
    $web = Project::query()->where('identifier', 'WEB')->value('id');
    Automation::query()->where('project_id', $web)->where('key', AutomationKey::AutoArchive)->update(['enabled' => false]);
    Automation::query()->where('project_id', $web)->where('key', AutomationKey::AssignOnStart)->delete();

    (new AutomationsSeeder)->run();

    expect(Automation::query()->where('project_id', $web)->where('key', AutomationKey::AutoArchive)->value('enabled'))->toBeFalse()
        ->and(Automation::query()->where('project_id', $web)->where('key', AutomationKey::AssignOnStart)->value('enabled'))->toBeTrue();
});

it('leaves Auto-Close off without a Canceled state in the workflow of the project', function () {
    $this->seed(DemoSeeder::class);
    $app = Project::query()->where('identifier', 'APP')->sole();
    Automation::query()->where('project_id', $app->id)->delete();
    WorkflowState::query()->where('workflow_id', $app->workflow_id)->where('category', StateCategory::Canceled)
        ->update(['category' => StateCategory::Completed]);

    (new AutomationsSeeder)->run();

    $close = Automation::query()->where('project_id', $app->id)->where('key', AutomationKey::AutoClose)->sole();
    expect([$close->enabled, $close->settings])->toBe([false, ['days' => 90, 'state_id' => null]]);
});
