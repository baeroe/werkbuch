<?php

use App\Domain\Schedule\Schedule;
use App\Models\Event;
use App\Models\Label;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Carbon\CarbonInterface;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\TemplatesSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// the demo files of the AttachmentsSeeder land on the disk `local`; the demo plays at 10:00 on Thursday 2026-11-05
beforeEach(function () {
    Storage::fake('local');
    $this->travelTo('2026-11-05 09:00:00');
});

/**
 * The templates of the clickdummy (src/api/seed/workspace.ts) and the log of their runs, parsed from the file: a
 * template copied wrong, a missed run or a changed seed shows here. A schedule is the object literal of its constant,
 * read as REST input.
 *
 * @return array{templates: array<string, array<string, mixed>>, runs: list<array{0: string, 1: string, 2: string|null, 3: string, 4: string|null}>}
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/workspace.ts'));
    $schedules = [];
    preg_match_all('/^const (\w+): Schedule = (\{.*\});$/m', $source, $constants, PREG_SET_ORDER);
    foreach ($constants as [, $name, $literal]) {
        $json = preg_replace('/([{,]\\s*)(\\w+):/', '$1"$2":', str_replace(['never', "'"], ['{ type: "never" }', '"'], $literal));
        $schedules[$name] = json_decode((string) $json, true, flags: JSON_THROW_ON_ERROR);
    }

    $start = (int) strpos($source, 'export const templates');
    $block = substr($source, $start, (int) strpos($source, "\n];\n", $start) - $start);
    $templates = [];
    foreach (array_slice(preg_split("/(?=\bid: 'tpl_)/", $block) ?: [], 1) as $chunk) {
        $field = fn (string $pattern): ?string => preg_match($pattern, $chunk, $match) === 1 ? $match[1] : null;
        $templates[(string) $field("/\bid: '(\\w+)'/")] = [
            'project' => strtoupper(substr((string) $field("/project_id: '(\\w+)'/"), 2)),
            'name' => $field("/\bname: '([^']*)'/"),
            'type' => $field("/type_id: '(\\w+)'/"),
            'title' => $field("/\btitle: '([^']*)'/"),
            'description' => $field("/description: rt\\('([^']*)'\\)/"),
            'priority' => $field("/priority: '(\\w+)'/"),
            'assignee' => $field('/assignee_id: USER_IDS\.(\w+)/'),
            'labels' => array_values(array_filter(explode(',', str_replace(["'", ' '], '', (string) $field('/label_ids: \[([^\]]*)\]/'))))),
            'due' => $field('/due_offset_days: (\w+)/'),
            'schedule' => $schedules[(string) $field('/schedule: (\w+)/')],
            'run_count' => (int) $field('/run_count: (\d+)/'),
            'last_run_at' => $field("/last_run_at: at\\('([^']*)'\\)/"),
            'by' => $field('/created_by: USER_IDS\.(\w+)/'),
        ];
    }

    preg_match_all("/created\\('run_\\w+', '(tpl_\\w+)', '([^']+)', '([A-Z]+-\\d+)'\\)/", $source, $created, PREG_SET_ORDER);
    preg_match_all("/template_id: '(tpl_\\w+)', scheduled_for: at\\('([^']+)'\\), work_item_id: null, status: 'failed', error: '([^']*)'/", $source, $failed, PREG_SET_ORDER);

    return [
        'templates' => $templates,
        'runs' => [
            ...array_map(fn (array $run) => [$run[1], $run[2], $run[3], 'created', null], $created),
            ...array_map(fn (array $run) => [$run[1], $run[2], null, 'failed', $run[3]], $failed),
        ],
    ];
};

/** Everything a rerun must leave as it is. */
$snapshot = fn (): array => [
    Event::count(),
    DB::table('templates')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all(),
    DB::table('template_runs')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all(),
    DB::table('work_items')->whereNotNull('template_id')->orderBy('id')->pluck('template_id', 'id')->all(),
];

$berlin = fn (?CarbonInterface $at) => $at?->clone()->setTimezone('Europe/Berlin')->format('m-d H:i');

it('seeds the three templates of the clickdummy with their payload and schedule', function () use ($clickdummy, $berlin) {
    $this->seed(DemoSeeder::class);
    ['templates' => $rows] = $clickdummy();
    $handles = User::query()->pluck('handle', 'id');
    $types = ['t_task' => 'Task', 't_bug' => 'Bug'];
    $labels = ['lb_backend' => 'Backend'];
    $stored = Template::query()->with('project')->get()->keyBy(fn (Template $template) => $template->project->identifier.'|'.$template->name);

    expect($rows)->toHaveCount(3)->and($stored)->toHaveCount(3);

    foreach ($rows as $id => $row) {
        $template = $stored["{$row['project']}|{$row['name']}"] ?? throw new RuntimeException("No template {$row['name']}.");
        $payload = $template->payload;

        expect([
            'type' => WorkItemType::query()->whereKey($payload['type_id'])->value('name'),
            'title' => $payload['title'],
            'description' => $payload['description'] === null ? null : $payload['description']['content'][0]['content'][0]['text'],
            'priority' => $payload['priority'],
            'assignee' => $payload['assignee_id'] === null ? null : $handles[$payload['assignee_id']],
            'labels' => Label::query()->whereIn('id', $payload['label_ids'])->pluck('name')->all(),
            'due' => $payload['due_offset_days'],
            'keys' => array_keys($payload),
            'schedule' => $template->schedule,
            'by' => $handles[$template->created_by],
            'last_run_at' => $berlin($template->last_run_at),
        ])->toBe([
            'type' => $types[$row['type']],
            'title' => $row['title'],
            'description' => $row['description'],
            'priority' => $row['priority'],
            'assignee' => $row['assignee'],
            'labels' => array_map(fn (string $label) => $labels[$label], $row['labels']),
            'due' => $row['due'] === 'null' ? null : (int) $row['due'],
            'keys' => ['type_id', 'title', 'description', 'priority', 'assignee_id', 'label_ids', 'values', 'parent_id', 'start_offset_days', 'due_offset_days'],
            'schedule' => Schedule::parse($row['schedule'])->toArray(),
            'by' => $row['by'],
            'last_run_at' => $row['last_run_at'],
        ], $id);

        // „Zertifikate prüfen“ failed its one scheduled run: that counts (A338), unlike the clickdummy's 0 (K20)
        expect($template->run_count)->toBe($id === 'tpl_ops_certs' ? 1 : $row['run_count'], $id);
    }
});

it('counts the schedules from the moment of seeding, so nothing is caught up', function () {
    $this->seed(DemoSeeder::class);
    $stored = Template::query()->get()->keyBy('name');

    expect($stored->map(fn (Template $template) => [$template->schedule_from?->toJSON(), $template->next_run_at?->toJSON()])->all())->toBe([
        // Mondays at 09:00 in Berlin
        'Wöchentliche Wartung' => ['2026-11-05T09:00:00.000000Z', '2026-11-09T08:00:00.000000Z'],
        // the first Monday of the month
        'Monatsbericht' => ['2026-11-05T09:00:00.000000Z', '2026-12-07T08:00:00.000000Z'],
        // paused
        'Zertifikate prüfen' => ['2026-11-05T09:00:00.000000Z', null],
    ]);
});

it('seeds the seven runs with their items and links those items to their template', function () use ($clickdummy, $berlin) {
    $this->seed(DemoSeeder::class);
    ['templates' => $rows, 'runs' => $runs] = $clickdummy();
    $names = collect($rows)->map(fn (array $row) => $row['name']);

    expect($runs)->toHaveCount(7);
    $stored = TemplateRun::query()->with(['template', 'workItem.project'])->orderBy('scheduled_for')->get()
        ->map(fn (TemplateRun $run) => [$run->template->name, $berlin($run->scheduled_for), $run->workItem?->key, $run->status, $run->error, $berlin($run->ran_at), $run->triggered_by])
        ->all();
    $expected = collect($runs)->sortBy(fn (array $run) => $run[1])->values()
        ->map(fn (array $run) => [$names[$run[0]], $run[1], $run[2], $run[3], $run[4], $run[1], null])->all();
    expect($stored)->toBe($expected);

    // the items the runs made carry their template; no other item does
    $linked = WorkItem::query()->with(['project', 'template'])->whereNotNull('template_id')->get()
        ->mapWithKeys(fn (WorkItem $item) => [$item->key => $item->template?->name])->sortKeys()->all();
    expect($linked)->toBe([
        'APP-4' => 'Monatsbericht', 'APP-8' => 'Monatsbericht',
        'WEB-34' => 'Wöchentliche Wartung', 'WEB-38' => 'Wöchentliche Wartung', 'WEB-46' => 'Wöchentliche Wartung', 'WEB-52' => 'Wöchentliche Wartung',
    ])->and(Event::query()->where('type', 'like', 'template.%')->count())->toBe(0);
});

it('changes nothing on a second run, keeps what somebody changed and brings back a template that is gone', function () use ($snapshot) {
    $this->seed(DemoSeeder::class);
    $before = $snapshot();

    (new TemplatesSeeder)->run();
    expect($snapshot())->toBe($before);

    // a template somebody changed stays as it is; a deleted one comes back with its log and links its items again
    $maintenance = Template::query()->where('name', 'Wöchentliche Wartung')->sole();
    $maintenance->forceFill(['payload' => [...$maintenance->payload, 'title' => 'Wartung'], 'run_count' => 9])->save();
    Template::query()->where('name', 'Monatsbericht')->delete();
    $updated = ItemsSeeder::find('APP-8')?->updated_at?->toJSON();
    // an item that names another template meanwhile keeps it
    ItemsSeeder::find('APP-4')?->forceFill(['template_id' => $maintenance->id])->save();

    (new TemplatesSeeder)->run();

    $maintenance->refresh();
    $report = Template::query()->where('name', 'Monatsbericht')->sole();
    expect([$maintenance->payload['title'], $maintenance->run_count])->toBe(['Wartung', 9])
        ->and($report->runs()->count())->toBe(2)
        ->and(ItemsSeeder::find('APP-8')?->template_id)->toBe($report->id)
        ->and(ItemsSeeder::find('APP-4')?->template_id)->toBe($maintenance->id)
        // linking an item is no change of it
        ->and(ItemsSeeder::find('APP-8')?->updated_at?->toJSON())->toBe($updated);
});
