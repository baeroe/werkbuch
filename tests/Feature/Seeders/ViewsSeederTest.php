<?php

use App\Models\Event;
use App\Models\Favorite;
use App\Models\PropertyOption;
use App\Models\User;
use App\Models\View;
use App\Models\WorkItemType;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\Storage;

// the demo files of the AttachmentsSeeder land on the disk `local`
beforeEach(fn () => Storage::fake('local'));

/**
 * The views and view favorites of the clickdummy (src/api/seed/workspace.ts), parsed from the file: a view that was
 * copied wrong, a missed one or a changed seed shows here.
 *
 * @return array{views: array<string, array<string, mixed>>, favorites: list<array{0: string, 1: string, 2: int}>}
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/workspace.ts'));
    $block = substr($source, (int) strpos($source, 'export const views'), (int) strpos($source, 'export const favorites') - (int) strpos($source, 'export const views'));
    $views = [];

    foreach (array_slice(preg_split("/(?=\bid: 'v_)/", $block) ?: [], 1) as $chunk) {
        $field = function (string $pattern) use ($chunk): ?string {
            preg_match($pattern, $chunk, $match);

            return $match[1] ?? null;
        };
        preg_match_all("/field: '([\w:]+)', op: '(\w+)', value: ([^}]+?) \}/", $chunk, $conditions, PREG_SET_ORDER);
        $name = (string) $field("/name: '([^']+)'/");
        // a view that uses listByState() has its display in the helper of the file
        $display = $field('/display: (listByState\(\))/') !== null
            ? ['group_by' => 'state', 'sort' => ['rank', 'asc'], 'fields' => ['key', 'title', 'state', 'assignee', 'priority', 'due_date'], 'show_sub_items' => true]
            : [
                'group_by' => $field("/group_by: '(\w+)'/"),
                'sort' => [$field("/sort: \{ field: '(\w+)'/"), $field("/direction: '(\w+)'/")],
                'fields' => str_contains($chunk, 'fields: [...FIELDS]')
                    ? ['key', 'title', 'state', 'assignee', 'priority', 'due_date']
                    : array_map(fn (string $f) => trim($f, " '"), explode(',', (string) $field('/fields: \[([^\]]+)\]/'))),
                'show_sub_items' => $field('/show_sub_items: (true|false)/') === 'true',
            ];
        $views[$name] = [
            'icon' => $field("/icon: '([\w-]+)'/"),
            'layout' => $field("/layout: '(\w+)'/") ?? 'list',
            'creator' => $field('/created_by: USER_IDS\.(\w+)/'),
            'created_at' => $field("/created_at: at\('([^']+)'\)/"),
            'display' => $display,
            'conditions' => array_map(fn (array $match) => [$match[1], $match[2], $match[3]], $conditions),
        ];
    }

    $favorites = [];
    preg_match_all("/user_id: USER_IDS\.(\w+), kind: 'view', id: '(v_\w+)', position: (\d+)/", $source, $matches, PREG_SET_ORDER);
    $names = [];
    preg_match_all("/id: '(v_\w+)',\s+name: '([^']+)'/", $block, $pairs, PREG_SET_ORDER);
    foreach ($pairs as $pair) {
        $names[$pair[1]] = $pair[2];
    }
    foreach ($matches as $match) {
        $favorites[] = [$match[1], $names[$match[2]], (int) $match[3]];
    }

    return ['views' => $views, 'favorites' => $favorites];
};

it('seeds the six views of the clickdummy with their filters', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    $expected = $clickdummy();
    // the values the clickdummy names by id or constant, as the seeder finds them by name, label and handle
    $option = fn (string $label) => PropertyOption::where('label', $label)->value('id');
    $value = fn (string $source) => match (true) {
        $source === '[...OPEN]' => ['backlog', 'unstarted', 'started'],
        $source === 'true' => true,
        $source === "'t_bug'" => WorkItemType::where('name', 'Bug')->value('id'),
        $source === "'opt_env_prod'" => $option('Produktion'),
        $source === "'opt_nordlicht'" => $option('Studio Nordlicht'),
        str_starts_with($source, 'USER_IDS.') => User::where('handle', substr($source, 9))->value('id'),
        default => trim($source, "'"),
    };

    expect($expected['views'])->toHaveCount(6)
        ->and(View::count())->toBe(6);

    foreach ($expected['views'] as $name => $view) {
        $seeded = View::query()->where('name', $name)->sole();

        expect($seeded->icon)->toBe($view['icon'])
            ->and($seeded->display['layout'])->toBe($view['layout'])
            ->and($seeded->creator->handle)->toBe($view['creator'])
            ->and(array_map(fn (array $c) => [$c['field'], $c['op']], $seeded->filter['conditions']))->toBe(array_map(fn (array $c) => [$c[0], $c[1]], $view['conditions']))
            ->and($seeded->filter['version'])->toBe(1)
            // the value of each condition, through the stable keys of the seed data
            ->and(array_map(fn (array $c) => $c['value'], $seeded->filter['conditions']))->toBe(array_map(fn (array $c) => $value($c[2]), $view['conditions']))
            ->and([$seeded->display['group_by'], [$seeded->display['sort']['field'], $seeded->display['sort']['direction']], $seeded->display['fields'], $seeded->display['show_sub_items']])
            ->toBe([$view['display']['group_by'], $view['display']['sort'], $view['display']['fields'], $view['display']['show_sub_items']])
            ->and($seeded->created_at->equalTo(ItemsSeeder::at($view['created_at'])))->toBeTrue()
            ->and($seeded->updated_at->equalTo($seeded->created_at))->toBeTrue();
    }
});

it('resolves the ids of the seed data through the stable keys', function () {
    $this->seed(DemoSeeder::class);
    $conditions = fn (string $name) => collect(View::query()->where('name', $name)->sole()->filter['conditions'])->keyBy('field');

    $bugs = $conditions('Bugs in Produktion');
    $kira = $conditions('Für Kira');

    expect($bugs['type']['value'])->toBe(WorkItemType::where('name', 'Bug')->value('id'))
        ->and($bugs['property:environment']['value'])->toBe(PropertyOption::where('label', 'Produktion')->value('id'))
        ->and($conditions('Studio Nordlicht')['property:customer']['value'])->toBe(PropertyOption::where('label', 'Studio Nordlicht')->value('id'))
        ->and($kira['assignee']['value'])->toBe(User::where('handle', 'kira')->value('id'))
        ->and($conditions('Fällig diese Woche')['due_date']['value'])->toBe('this_week');
});

it('stars the views of the clickdummy with their positions', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    $expected = $clickdummy();
    $views = View::pluck('name', 'id');
    $actual = Favorite::query()->where('favoritable_type', 'view')->get()
        ->map(fn (Favorite $favorite) => [User::find($favorite->user_id)->handle, $views[$favorite->favoritable_id], $favorite->position])->all();

    expect($expected['favorites'])->toHaveCount(6)
        ->and($actual)->toEqualCanonicalizing($expected['favorites'])
        ->and(collect($actual)->where(0, 'mara'))->toHaveCount(3);
});

it('keeps a view an admin changed and creates no event when seeding again', function () {
    $this->seed(DemoSeeder::class);
    $events = Event::count();
    $view = View::query()->where('name', 'Roadmap')->sole();
    $view->update(['icon' => 'star', 'filter' => ['version' => 1, 'conditions' => [['field' => 'priority', 'op' => 'is', 'value' => 'urgent']]]]);
    $changed = $view->fresh()->updated_at;

    $this->seed(DemoSeeder::class);

    expect(View::count())->toBe(6)
        ->and(View::query()->where('name', 'Roadmap')->sole()->icon)->toBe('star')
        ->and(View::query()->where('name', 'Roadmap')->sole()->filter['conditions'])->toHaveCount(1)
        ->and(View::query()->where('name', 'Roadmap')->sole()->updated_at->equalTo($changed))->toBeTrue()
        ->and(Favorite::query()->where('favoritable_type', 'view')->count())->toBe(6)
        ->and(Event::count())->toBe($events);
});

it('takes a view of the same name and creator instead of adding another, but not that of someone else', function () {
    $this->seed(DemoSeeder::class);
    View::query()->where('name', 'Blockiert')->delete();
    $other = User::where('handle', 'lene')->sole();
    View::factory()->create(['name' => 'Blockiert', 'created_by' => $other->id]);

    $this->seed(DemoSeeder::class);

    expect(View::query()->where('name', 'Blockiert')->count())->toBe(2)
        ->and(View::query()->where('name', 'Blockiert')->where('created_by', User::where('handle', 'jonas')->value('id'))->count())->toBe(1);
});

it('stars the oldest view when somebody has another one of the same name, however often it seeds', function () {
    $this->seed(DemoSeeder::class);
    $mara = User::where('handle', 'mara')->sole();
    $first = View::query()->where('name', 'Für Kira')->where('created_by', $mara->id)->sole();
    View::factory()->create(['name' => 'Für Kira', 'created_by' => $mara->id]);

    $this->seed(DemoSeeder::class);
    $this->seed(DemoSeeder::class);

    expect(View::query()->where('name', 'Für Kira')->count())->toBe(2)
        ->and(Favorite::query()->where('user_id', $mara->id)->where('favoritable_type', 'view')->pluck('favoritable_id')->all())
        ->toContain($first->id)->toHaveCount(3);
});
