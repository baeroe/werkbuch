<?php

namespace Database\Seeders\Demo;

use App\Domain\Filter\FilterSchema;
use App\Domain\Views\DisplaySchema;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItemType;
use App\Views\CatalogProperties;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * The six team views of the clickdummy (src/api/seed/workspace.ts; `ViewsSeederTest` reads that file). Written
 * directly and without events, like the other demo seeders (A86). Types are found by name, options by label, people by
 * handle. Filter and display go through the schemas of the engine, so a typo in the seed fails here instead of in a
 * list. A view is looked up by name and creator (names are not unique, K27) and written only when it is missing:
 * whatever an admin changed stays.
 */
class ViewsSeeder extends Seeder
{
    use WithoutModelEvents;

    private const FIELDS = ['key', 'title', 'state', 'assignee', 'priority', 'due_date'];

    /** Open means anything but Completed and Canceled. */
    private const OPEN = ['backlog', 'unstarted', 'started'];

    /** The creator of each view, by handle. */
    public const CREATORS = [
        'Fällig diese Woche' => 'mara', 'Bugs in Produktion' => 'ida', 'Für Kira' => 'mara',
        'Studio Nordlicht' => 'theo', 'Roadmap' => 'mara', 'Blockiert' => 'jonas',
    ];

    public function run(): void
    {
        $people = User::query()->pluck('id', 'handle');
        $bug = WorkItemType::query()->where('name', 'Bug')->value('id');
        $option = fn (string $key, string $label) => PropertyOption::query()->where('label', $label)
            ->whereIn('property_id', Property::query()->where('key', $key)->select('id'))->value('id') ?? throw new RuntimeException("No option {$label}.");
        $catalog = CatalogProperties::load();
        $list = fn (string $groupBy, array $fields = self::FIELDS): array => ['layout' => 'list', 'group_by' => $groupBy, 'sort' => ['field' => 'rank', 'direction' => 'asc'], 'fields' => $fields, 'show_sub_items' => true];

        $views = [
            ['Fällig diese Woche', 'calendar-clock', '09-14 10:00', [
                ['field' => 'state_category', 'op' => 'in', 'value' => self::OPEN],
                ['field' => 'due_date', 'op' => 'is', 'value' => 'this_week'],
            ], ['layout' => 'list', 'group_by' => 'project', 'sort' => ['field' => 'due_date', 'direction' => 'asc'], 'fields' => self::FIELDS, 'show_sub_items' => false]],
            ['Bugs in Produktion', 'bug', '09-21 15:30', [
                ['field' => 'type', 'op' => 'is', 'value' => $bug],
                ['field' => 'property:environment', 'op' => 'is', 'value' => $option('environment', 'Produktion')],
            ], ['layout' => 'board', 'group_by' => 'state', 'sort' => ['field' => 'priority', 'direction' => 'asc'], 'fields' => ['key', 'title', 'assignee', 'priority', 'labels'], 'show_sub_items' => false]],
            ['Für Kira', 'bot', '10-05 14:00', [
                ['field' => 'assignee', 'op' => 'is', 'value' => $people['kira']],
            ], $list('state')],
            ['Studio Nordlicht', 'building-2', '10-01 11:15', [
                ['field' => 'property:customer', 'op' => 'is', 'value' => $option('customer', 'Studio Nordlicht')],
            ], ['layout' => 'table', 'group_by' => 'none', 'sort' => ['field' => 'key', 'direction' => 'asc'], 'fields' => ['key', 'title', 'state', 'assignee', 'due_date', 'property:customer', 'property:effort'], 'show_sub_items' => true]],
            ['Roadmap', 'route', '09-28 09:45', [],
                ['layout' => 'timeline', 'group_by' => 'project', 'sort' => ['field' => 'start_date', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => false]],
            ['Blockiert', 'octagon-alert', '10-12 16:20', [
                ['field' => 'blocked', 'op' => 'is', 'value' => true],
            ], $list('state')],
        ];

        foreach ($views as [$name, $icon, $created, $conditions, $display]) {
            $creator = self::CREATORS[$name];
            $exists = View::query()->where('name', $name)->where('created_by', $people[$creator])->exists();

            if ($exists) {
                continue;
            }

            $at = Carbon::instance(ItemsSeeder::at($created));
            $view = new View([
                'name' => $name,
                'icon' => $icon,
                'filter' => FilterSchema::parse(['version' => 1, 'conditions' => $conditions], $catalog)->toArray(),
                'display' => DisplaySchema::parse($display, $catalog)->toArray(),
                'created_by' => $people[$creator],
            ]);
            $view->created_at = $at;
            $view->updated_at = $at;
            $view->save();
        }
    }
}
