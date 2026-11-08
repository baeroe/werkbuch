<?php

use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\Event;
use App\Models\Favorite;
use App\Models\Label;
use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\RelationType;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItemType;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\Demo\Texts\English;
use Database\Seeders\Demo\Texts\German;
use Database\Seeders\DemoSeeder;
use Database\Seeders\DemoSeederEn;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DemoBasicsSeeder;
use Tests\Support\EnglishDemoBasicsSeeder;
use Tests\Support\SharedDemoTexts;

// the language is static: a test that fails midway must not leave English to the next one
afterEach(fn () => DemoTexts::use(Locale::De));

beforeEach(function () {
    // the demo files of the AttachmentsSeeder land on the disk `local`; the seeders end with a rebuilt search index
    Storage::fake('local');
    searchEngine();
});

$germanIn = SharedDemoTexts::germanIn(...);

/**
 * Every text the demo seeders up to the tokens write, by table, so a second run and a stray German text show.
 *
 * @return array<string, mixed>
 */
$texts = fn (): array => [
    'organization' => Organization::query()->get(['id', 'name', 'locale', 'timezone', 'week_start'])->toArray(),
    'users' => User::query()->orderBy('id')->get(['id', 'name', 'handle', 'email', 'locale', 'timezone', 'description', 'owner_id', 'disabled_at'])->toArray(),
    'workflows' => Workflow::query()->orderBy('id')->get(['id', 'name', 'description', 'is_default', 'is_free', 'initial_state_id', 'updated_at'])->toArray(),
    'states' => WorkflowState::query()->orderBy('id')->get(['id', 'workflow_id', 'name', 'position'])->toArray(),
    'transitions' => DB::table('workflow_transitions')->orderBy('id')->get()->toArray(),
    'types' => WorkItemType::query()->orderBy('id')->get(['id', 'name', 'description', 'icon', 'tone', 'is_epic', 'archived_at'])->toArray(),
    'type_properties' => DB::table('type_properties')->orderBy('id')->get()->toArray(),
    'properties' => Property::query()->orderBy('id')->get(['id', 'key', 'label', 'help', 'settings', 'default_value'])->toArray(),
    'options' => PropertyOption::query()->orderBy('id')->get(['id', 'property_id', 'label', 'color', 'position', 'archived_at'])->toArray(),
    'labels' => Label::query()->orderBy('id')->get(['id', 'name', 'color'])->toArray(),
    'relation_types' => RelationType::query()->orderBy('id')->get(['id', 'name', 'outward_label', 'inward_label', 'built_in'])->toArray(),
    'projects' => Project::query()->orderBy('id')->get(['id', 'identifier', 'name', 'description', 'lead_id', 'visibility', 'workflow_id', 'default_type_id', 'updated_at'])->toArray(),
    'project_types' => DB::table('project_types')->orderBy('id')->get()->toArray(),
    'members' => DB::table('project_members')->orderBy('id')->get()->toArray(),
    'views' => View::query()->orderBy('id')->get(['id', 'name', 'icon', 'filter', 'display', 'created_by', 'created_at', 'updated_at'])->toArray(),
    'favorites' => Favorite::query()->orderBy('id')->get(['id', 'user_id', 'favoritable_type', 'favoritable_id', 'position'])->toArray(),
    'tokens' => PersonalAccessToken::query()->orderBy('id')->get(['id', 'name', 'token', 'abilities', 'expires_at', 'last_used_at', 'created_at'])->toArray(),
];

/**
 * The views as the seeders made them, their filters and displays with every id replaced by what it names in either
 * language: an account by its handle, a type by its place in the catalog, an option by its property and place.
 *
 * @return array<int, array<string, mixed>>
 */
$views = function (): array {
    $ids = [
        ...User::query()->pluck('handle', 'id')->map(fn (string $handle) => "user:{$handle}")->all(),
        ...WorkItemType::query()->orderBy('id')->pluck('id')->flip()->map(fn (int $place) => "type:{$place}")->all(),
        ...Property::query()->with('options')->get()->flatMap(fn (Property $property) => $property->options
            ->mapWithKeys(fn (PropertyOption $option) => [$option->id => "option:{$property->key}:{$option->position}"]))->all(),
    ];

    return View::query()->with('creator')->orderBy('id')->get()->map(fn (View $view) => [
        'icon' => $view->icon,
        'creator' => $view->creator->handle,
        'created_at' => $view->created_at?->toJSON(),
        'filter' => strtr((string) json_encode($view->filter), $ids),
        'display' => strtr((string) json_encode($view->display), $ids),
    ])->all();
};

it('knows every key in both languages', function () {
    $keys = array_keys(German::TEXTS);
    sort($keys);
    $english = array_keys(English::TEXTS);
    sort($english);

    expect($english)->toBe($keys)->and(count($keys))->toBeGreaterThan(80);

    foreach ([German::TEXTS, English::TEXTS] as $texts) {
        foreach ($texts as $key => $text) {
            expect(mb_strlen(trim($text)))->toBeGreaterThan(0, $key);
        }
    }
});

it('writes no German into the English texts', function () use ($germanIn) {
    $found = array_filter(array_map($germanIn, English::TEXTS));
    $shared = array_keys(SharedDemoTexts::KEYS);

    expect($found)->toBe([])
        // key by key: an English text equal to the German one needs its reason in SharedDemoTexts
        ->and(SharedDemoTexts::untranslated())->toBe([])
        // and every reason names a key both languages really share
        ->and(array_values(array_filter($shared, fn (string $key) => German::TEXTS[$key] !== English::TEXTS[$key])))->toBe([])
        // the probe: an untranslated copy without an umlaut or a listed word fails, one with a reason does not
        ->and(SharedDemoTexts::untranslated([...English::TEXTS, 'catalog.state.approval' => 'Kundenfreigabe', 'catalog.label.forms' => 'Formulare']))
        ->toBe(['catalog.state.approval', 'catalog.label.forms'])
        ->and(SharedDemoTexts::untranslated([...English::TEXTS, 'catalog.type.task.name' => 'Task']))->toBe([])
        ->and(SharedDemoTexts::germanOnly())->toContain('Kundenfreigabe', 'Formulare', 'Infrastruktur')->not->toContain('Backlog')
        // a path is no text: it names a key of both languages and stays out of what an English text may not hold
        ->and(array_diff_key(SharedDemoTexts::NOT_TEXTS, array_intersect_key(German::TEXTS, English::TEXTS)))->toBe([])
        ->and(SharedDemoTexts::germanOnly())->not->toContain(German::TEXTS['file.folder'])
        // the probe: the rule finds the German texts, a letter and a word alike
        ->and(count(array_filter(array_map($germanIn, German::TEXTS))))->toBeGreaterThan(20)
        ->and([$germanIn('Gärtnerei Moos'), $germanIn('Für Kira'), $germanIn('Browser und Version')])->toBe(['ä', 'Für', 'und']);
});

it('takes the texts of the shipped entries from lang in both languages (T22a-M3)', function () {
    // the demo key of a shipped entry and the key of lang/*.json that ships it
    $shipped = [
        'catalog.workflow.standard.name' => 'catalog.builtin.workflow.name',
        'catalog.workflow.standard.description' => 'catalog.builtin.workflow.description',
        'catalog.property.effort.label' => 'catalog.builtin.property.effort.label',
        'catalog.property.effort.help' => 'catalog.builtin.property.effort.help',
        'catalog.type.task.description' => 'catalog.builtin.type.task.description',
        'catalog.type.epic.description' => 'catalog.builtin.type.epic.description',
        'catalog.relation.blocks.name' => 'catalog.builtin.relation.blocks.name',
        'catalog.relation.blocks.outward' => 'catalog.builtin.relation.blocks.outward',
        'catalog.relation.blocks.inward' => 'catalog.builtin.relation.blocks.inward',
        'catalog.relation.duplicates.name' => 'catalog.builtin.relation.duplicates.name',
        'catalog.relation.duplicates.outward' => 'catalog.builtin.relation.duplicates.outward',
        'catalog.relation.duplicates.inward' => 'catalog.builtin.relation.duplicates.inward',
        'catalog.relation.relates.name' => 'catalog.builtin.relation.relates.name',
        'catalog.relation.relates.outward' => 'catalog.builtin.relation.relates.outward',
    ];

    foreach (['de' => German::TEXTS, 'en' => English::TEXTS] as $locale => $texts) {
        foreach ($shipped as $demo => $lang) {
            expect(__($lang, [], $locale))->not->toBe($lang, "lang/{$locale}.json lacks {$lang}")
                ->and($texts[$demo])->toBe(__($lang, [], $locale), "{$demo} ({$locale})");
        }
        // the demo's bug asks for the environment: the shipped sentence, then its own
        expect($texts['catalog.type.bug.description'])->toStartWith(__('catalog.builtin.type.bug.description', [], $locale).' ');
    }
});

it('throws for a key the language lacks, in either language', function () {
    foreach (Locale::cases() as $locale) {
        DemoTexts::use($locale);

        expect(DemoTexts::current())->toBe($locale)
            ->and(fn () => DemoTexts::get('person.nobody.name'))->toThrow(RuntimeException::class, "lack the key person.nobody.name ({$locale->value})");
    }

    DemoTexts::use(Locale::De);

    expect(DemoTexts::get('organization.name'))->toBe('Feldwerk')
        ->and(DemoTexts::get('organization.name', Locale::En))->toBe('Fieldwork')
        ->and(DemoTexts::current())->toBe(Locale::De);
});

it('seeds the organization, people, catalog, projects and views in English', function () use ($germanIn, $texts) {
    $this->seed(EnglishDemoBasicsSeeder::class);
    $organization = Organization::current()->fresh();
    $people = User::query()->where('type', AccountType::Person)->orderBy('handle')->get();
    $agency = Workflow::query()->where('name', 'Agency approval')->with(['states', 'transitions'])->sole();
    $types = WorkItemType::query()->orderBy('id')->get();
    $relation = fn (string $kind) => RelationType::query()->where('built_in', $kind)->sole();

    // the seeder hands the language back when it is done
    expect(DemoTexts::current())->toBe(Locale::De)
        ->and([$organization?->name, $organization?->locale, $organization?->timezone, $organization?->week_start])->toBe(['Fieldwork', Locale::En, 'Europe/Berlin', 1])
        ->and($people->pluck('handle')->all())->toBe(['ida', 'jonas', 'lene', 'mara', 'sven', 'theo'])
        ->and($people->pluck('email')->all())->toBe(['ida@fieldwork.example.com', 'jonas@fieldwork.example.com', 'lene@fieldwork.example.com', 'mara@fieldwork.example.com', 'sven@fieldwork.example.com', 'theo@fieldwork.example.com'])
        ->and($people->pluck('name')->all())->toBe(['Ida Brennan', 'Jonas Field', 'Lene Vaughan', 'Mara Lindley', 'Sven Albright', 'Theo Okafor'])
        ->and($people->map(fn (User $user) => $user->locale)->unique()->all())->toBe([Locale::En])
        ->and(User::defaultBot()->description)->toBe(__('bots.default.description', [], 'en'))
        ->and(User::query()->where('handle', 'kira')->sole()->only(['name', 'description', 'locale']))
        ->toBe(['name' => 'Kira', 'description' => 'Mara’s bot. Works over MCP on the items assigned to it.', 'locale' => Locale::En])
        // the workflow of the agency, with the states and moves of the German one
        ->and(Workflow::query()->orderBy('id')->pluck('name')->all())->toBe(['Standard', 'Agency approval'])
        ->and(Workflow::default()->description)->toBe(__('catalog.builtin.workflow.description', [], 'en'))
        ->and($agency->states->pluck('name')->all())->toBe(['Backlog', 'Todo', 'In Progress', 'Review', 'Client approval', 'Done', 'Cancelled'])
        ->and($agency->transitions)->toHaveCount(14)
        ->and($agency->graph()->issues())->toBe([])
        ->and($types->pluck('name')->all())->toBe(['Task', 'Bug', 'Epic', 'Client request'])
        ->and($types->pluck('description')->take(3)->all())->toBe([
            __('catalog.builtin.type.task.description', [], 'en'),
            __('catalog.builtin.type.bug.description', [], 'en').' The environment it occurs in is required.',
            __('catalog.builtin.type.epic.description', [], 'en'),
        ])
        ->and(Property::query()->where('key', 'effort')->sole()->only(['label', 'help']))
        ->toBe(['label' => __('catalog.builtin.property.effort.label', [], 'en'), 'help' => __('catalog.builtin.property.effort.help', [], 'en')])
        ->and(Property::query()->where('key', 'customer')->sole()->options->pluck('label')->all())->toBe(['Studio Northlight', 'Harbour Office', 'Moss Nursery'])
        ->and(Label::query()->orderBy('id')->pluck('name')->all())->toBe(['UX', 'Forms', 'Production', 'Performance', 'SEO', 'Accessibility', 'Backend', 'Design'])
        ->and($relation('blocks')->only(['name', 'outward_label', 'inward_label']))->toBe([
            'name' => __('catalog.builtin.relation.blocks.name', [], 'en'),
            'outward_label' => __('catalog.builtin.relation.blocks.outward', [], 'en'),
            'inward_label' => __('catalog.builtin.relation.blocks.inward', [], 'en'),
        ])
        ->and($relation('duplicates')->only(['name', 'outward_label', 'inward_label']))->toBe([
            'name' => __('catalog.builtin.relation.duplicates.name', [], 'en'),
            'outward_label' => __('catalog.builtin.relation.duplicates.outward', [], 'en'),
            'inward_label' => __('catalog.builtin.relation.duplicates.inward', [], 'en'),
        ])
        ->and($relation('relates')->only(['name', 'outward_label', 'inward_label']))->toBe([
            'name' => __('catalog.builtin.relation.relates.name', [], 'en'),
            'outward_label' => __('catalog.builtin.relation.relates.outward', [], 'en'),
            'inward_label' => null,
        ])
        ->and(RelationType::query()->whereNull('built_in')->sole()->only(['name', 'outward_label', 'inward_label']))
        ->toBe(['name' => 'tests', 'outward_label' => 'tests', 'inward_label' => 'is tested by'])
        // the projects keep their identifiers; APP works with the agency's workflow and the client requests
        ->and(Project::query()->orderBy('identifier')->pluck('name', 'identifier')->all())->toBe(['APP' => 'Client app', 'OPS' => 'Infrastructure', 'WEB' => 'Website relaunch'])
        ->and(Project::query()->where('identifier', 'APP')->sole()->workflow_id)->toBe($agency->id)
        ->and(Project::query()->where('identifier', 'APP')->sole()->types->pluck('name')->all())->toBe(['Task', 'Bug', 'Epic', 'Client request'])
        ->and(View::query()->orderBy('name')->pluck('name')->all())->toBe(['Blocked', 'Bugs in production', 'Due this week', 'For Kira', 'Roadmap', 'Studio Northlight'])
        ->and(Favorite::query()->count())->toBe(15)
        ->and(PersonalAccessToken::query()->orderBy('name')->pluck('name')->all())->toBe(['CI script', 'Claude Code', 'MCP']);

    // no text of the German demo reached a row, unless both languages share it (Backlog, Task, UX, Kira, …)
    $german = SharedDemoTexts::germanOnly();
    $written = collect($texts())->flatten()->filter(fn (mixed $value) => is_string($value))->unique()->values();

    expect($written->intersect($german)->values()->all())->toBe([])
        ->and($written->map($germanIn)->filter()->values()->all())->toBe([])
        // the probe: the rows read hold the texts of the seeders
        ->and($written->intersect(English::TEXTS)->count())->toBeGreaterThan(80);
});

it('seeds the views with the filters and displays of the German demo', function () use ($views) {
    DB::beginTransaction();
    $this->seed(DemoBasicsSeeder::class);
    $german = $views();
    DB::rollBack();
    // the organization and the roles of the German run are gone with it
    app()->forgetScopedInstances();

    $this->seed(EnglishDemoBasicsSeeder::class);

    expect($german)->toHaveCount(6)
        ->and($views())->toBe($german)
        // the probe: the views name accounts, types and options of the catalog, by what they are
        ->and(implode(' ', array_column($german, 'filter')))->toContain('user:kira', 'type:1', 'option:environment:0', 'option:customer:0');
});

it('seeds the English demo twice without a change', function () use ($texts) {
    $this->seed(EnglishDemoBasicsSeeder::class);
    $before = $texts();
    $events = Event::query()->count();
    $this->travel(5)->minutes();

    $this->seed(EnglishDemoBasicsSeeder::class);

    expect($texts())->toEqual($before)
        ->and(Event::query()->count())->toBe($events)
        ->and(count($before['views']))->toBe(6)
        ->and(count($before['favorites']))->toBe(15);
});

it('refuses English demo data on a German demo database', function () {
    $this->seed(DemoBasicsSeeder::class);

    expect(fn () => $this->seed(DemoSeederEn::class))->toThrow(RuntimeException::class, 'holds the demo data of Feldwerk')
        ->and(Organization::current()->fresh()?->name)->toBe('Feldwerk')
        ->and(User::query()->where('email', 'like', '%@fieldwork.example.com')->count())->toBe(0)
        ->and(DemoTexts::current())->toBe(Locale::De);
});

it('refuses English demo data on a German demo database whose organization was renamed (T22a-M4)', function () {
    $this->seed(DemoBasicsSeeder::class);
    Organization::current()->update(['name' => 'Werkstatt']);

    // the mail domain of mara is the second mark: a readable refusal, not a unique handle
    expect(fn () => $this->seed(DemoSeederEn::class))->toThrow(RuntimeException::class, 'holds the demo data of Werkstatt (de)')
        ->and(User::query()->where('email', 'like', '%@fieldwork.example.com')->count())->toBe(0)
        ->and(DemoTexts::current())->toBe(Locale::De);
});

it('refuses German demo data on an English demo database', function () {
    $this->seed(EnglishDemoBasicsSeeder::class);

    expect(fn () => $this->seed(DemoSeeder::class))->toThrow(RuntimeException::class, 'holds the demo data of Fieldwork')
        ->and(Organization::current()->fresh()?->name)->toBe('Fieldwork')
        ->and(User::query()->where('email', 'like', '%@feldwerk.example.com')->count())->toBe(0)
        ->and(DemoTexts::current())->toBe(Locale::De);
});
