<?php

namespace Database\Seeders\Demo;

use App\Domain\Schedule\Schedule;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\RichText\Document;
use App\Support\TemplateSchedule;
use Database\Seeders\Demo\Texts\DemoTexts;
use DateTimeZone;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The three templates of the clickdummy (src/api/seed/workspace.ts; `TemplatesSeederTest` reads that file and compares
 * template by template) with the log of their seven runs: „Wöchentliche Wartung“ of WEB (Mondays 09:00), „Monatsbericht“
 * of APP (the first Monday of the month) and „Zertifikate prüfen“ of OPS (paused since its one run failed). After the
 * ItemsSeeder: a run names the item it made, and those six items get their template (`template_id`, only where it is
 * empty, without touching `updated_at`; K20). The description is the Tiptap JSON of the clickdummy's `rt()`.
 *
 * Name, title and description come from DemoTexts (`template.<key>.name|title|description`, the key the seed's id
 * without `tpl_`; a title keeps its placeholders, the month names come from the language of the organization at run
 * time). The error of the failed run is the sentence the app writes in the language of the demo (failure()).
 *
 * Deviations from the seed (K20): „Zertifikate prüfen“ counts its failed scheduled run (`run_count` 1, A338: a failed
 * run counts, the seed says 0), and every schedule counts from the moment of seeding (`schedule_from` now, `next_run_at`
 * the first term after it on the calendar of the organisation), so nothing is caught up. A template is created a day
 * before its first term (the seed has no time).
 *
 * Written directly, without events, like the other demo seeders (A86). Safe to run again, and it never touches a
 * template that exists (like K13): it creates the templates whose (project, name) is missing, with their runs.
 */
class TemplatesSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * The templates: key of the texts, project, creator, created (`MM-DD HH:mm`, Berlin), type and labels (keys of the
     * catalog texts), priority, assignee, due offset, schedule (REST input), run count, last term and the runs (term, item
     * key or null for a failed one), with the required property its failed run lacked.
     *
     * @var list<array{key: string, project: string, by: string, created: string, type: string, priority: string, assignee: ?string, labels: list<string>, due: ?int, schedule: array<string, mixed>, run_count: int, last: string, runs: list<array{0: string, 1: ?string}>, missing?: string}>
     */
    private const TEMPLATES = [
        [
            'key' => 'web_maintenance', 'project' => 'WEB', 'by' => 'ida', 'created' => '10-04 10:00',
            'type' => 'task', 'priority' => 'medium', 'assignee' => 'jonas', 'labels' => ['backend'], 'due' => 2,
            'schedule' => ['frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-10-05', 'ends' => ['type' => 'never'], 'paused' => false],
            'run_count' => 4, 'last' => '10-26 09:00',
            'runs' => [['10-05 09:00', 'WEB-34'], ['10-12 09:00', 'WEB-38'], ['10-19 09:00', 'WEB-46'], ['10-26 09:00', 'WEB-52']],
        ],
        [
            'key' => 'app_report', 'project' => 'APP', 'by' => 'theo', 'created' => '08-31 10:00',
            'type' => 'task', 'priority' => 'medium', 'assignee' => 'theo', 'labels' => [], 'due' => null,
            'schedule' => ['frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00', 'starts_on' => '2026-09-01', 'ends' => ['type' => 'never'], 'paused' => false],
            'run_count' => 2, 'last' => '10-05 09:00',
            'runs' => [['09-07 09:00', 'APP-4'], ['10-05 09:00', 'APP-8']],
        ],
        [
            // a Bug has the required environment, the template does not fill it: its run failed, and it is paused since
            'key' => 'ops_certs', 'project' => 'OPS', 'by' => 'mara', 'created' => '09-30 10:00',
            'type' => 'bug', 'priority' => 'medium', 'assignee' => null, 'labels' => [], 'due' => null,
            'schedule' => ['frequency' => 'monthly', 'interval' => 1, 'month_day' => 1, 'time' => '07:00', 'starts_on' => '2026-10-01', 'ends' => ['type' => 'never'], 'paused' => true],
            'run_count' => 1, 'last' => '10-01 07:00',
            'runs' => [['10-01 07:00', null]], 'missing' => 'environment',
        ],
    ];

    public function run(): void
    {
        // one transaction: a template without its runs would stay so for good (a rerun skips every template that exists)
        DB::transaction(function (): void {
            $people = User::query()->pluck('id', 'handle')->all();
            $zone = new DateTimeZone(Organization::current()->timezone);

            foreach (self::TEMPLATES as $row) {
                $project = Project::query()->where('identifier', $row['project'])->value('id') ?? throw new RuntimeException("No project {$row['project']}.");
                $template = Template::query()->where('project_id', $project)->where('name', DemoTexts::get("template.{$row['key']}.name"))->first()
                    ?? $this->create($project, $row, $people, $zone);

                // the items its runs made, where nothing names a template yet (a change of no item: no `updated_at`)
                $items = array_filter(array_map(fn (array $run) => $run[1] === null ? null : ItemsSeeder::find($run[1])?->id, $row['runs']));
                WorkItem::query()->whereKey($items)->whereNull('template_id')->toBase()->update(['template_id' => $template->id]);
            }
        });
    }

    /**
     * @param  array{key: string, project: string, by: string, created: string, type: string, priority: string, assignee: ?string, labels: list<string>, due: ?int, schedule: array<string, mixed>, run_count: int, last: string, runs: list<array{0: string, 1: ?string}>, missing?: string}  $row
     * @param  array<string, string>  $people  IDs by handle
     */
    private function create(string $project, array $row, array $people, DateTimeZone $zone): Template
    {
        $schedule = Schedule::parse($row['schedule']);
        $now = now()->toImmutable();
        $created = ItemsSeeder::at($row['created']);
        $text = "template.{$row['key']}.description";
        $description = ! DemoTexts::has($text) ? null : Document::fromJson(['type' => 'doc', 'content' => array_map(
            fn (string $paragraph) => ['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $paragraph]]],
            preg_split('/\n{2,}/', DemoTexts::get($text)) ?: [],
        )])->toJson();
        $type = DemoTexts::get("catalog.type.{$row['type']}.name");

        $template = new Template;
        $template->forceFill([
            'project_id' => $project,
            'name' => DemoTexts::get("template.{$row['key']}.name"),
            'payload' => [
                'type_id' => WorkItemType::query()->where('name', $type)->value('id') ?? throw new RuntimeException("No type {$type}."),
                'title' => DemoTexts::get("template.{$row['key']}.title"),
                'description' => $description,
                'priority' => $row['priority'],
                'assignee_id' => $row['assignee'] === null ? null : self::person($people, $row['assignee']),
                'label_ids' => Label::query()->whereIn('name', array_map(fn (string $label) => DemoTexts::get("catalog.label.{$label}"), $row['labels']))->orderBy('id')->pluck('id')->all(),
                'values' => [],
                'parent_id' => null,
                'start_offset_days' => null,
                'due_offset_days' => $row['due'],
            ],
            'schedule' => $schedule->toArray(),
            'schedule_from' => $now,
            'next_run_at' => TemplateSchedule::nextRunAt($schedule, $now, $row['run_count'], $now, $zone),
            'last_run_at' => ItemsSeeder::at($row['last']),
            'run_count' => $row['run_count'],
            'created_by' => self::person($people, $row['by']),
            'created_at' => $created,
            'updated_at' => $created,
        ])->save();

        foreach ($row['runs'] as $run) {
            $term = ItemsSeeder::at($run[0]);
            (new TemplateRun)->forceFill([
                'template_id' => $template->id,
                'scheduled_for' => $term,
                'ran_at' => $term,
                'status' => $run[1] === null ? TemplateRun::FAILED : TemplateRun::CREATED,
                'work_item_id' => $run[1] === null ? null : ItemsSeeder::find($run[1])?->id,
                'error' => $run[1] === null ? self::failure($row['missing'] ?? throw new RuntimeException('A failed run names the property it lacked.')) : null,
            ])->save();
        }

        return $template;
    }

    /**
     * The sentence the app writes for a run that lacks a required property (TemplateRunError), in the language of the
     * demo, with the property's label: also the error of the inbox row of that run.
     */
    public static function failure(string $property): string
    {
        return __('templates.run.required_missing.one', ['properties' => DemoTexts::get("catalog.property.{$property}.label")], DemoTexts::current()->value);
    }

    /**
     * @param  array<string, string>  $people
     */
    private static function person(array $people, string $handle): string
    {
        return $people[$handle] ?? throw new RuntimeException("No account @{$handle}.");
    }
}
