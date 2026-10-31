<?php

use App\Access\OrgRole;
use App\Access\RoleIndex;
use App\Access\Visibility;
use App\Enums\AccountType;
use App\Models\Event;
use App\Models\Favorite;
use App\Models\Label;
use App\Models\Organization;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\ProjectMember;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DemoSeeder;
use Database\Seeders\E2eSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

// the default bot of the migration is always there: the tests read it by its flag

/** The clickdummy's seed (prototypes/clickdummy/src/api/seed/people.ts), as the Demo seeders have to reproduce it. */
function clickdummySeed(): array
{
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/people.ts'));

    preg_match_all("/person\('u_\w+', '([^']+)', '(\w+)'(?:, '(admin|member)')?/", $source, $people, PREG_SET_ORDER);
    preg_match_all("/identifier: '(\w+)',\s*name: '([^']+)',\s*description: '([^']+)',\s*image_url: null,\s*lead_id: 'u_(\w+)',\s*visibility: '(\w+)'/", $source, $projects, PREG_SET_ORDER);
    preg_match_all("/project_id: 'p_(\w+)', user_id: 'u_(\w+)', role: '(\w+)'/", $source, $members, PREG_SET_ORDER);
    preg_match_all("/handle: '(\w+)',\s*email: null,\s*org_role: '(\w+)',.*?description: '([^']+)'/s", $source, $bots, PREG_SET_ORDER);

    return compact('people', 'projects', 'members', 'bots');
}

/** The catalog of the clickdummy (src/api/seed/config.ts), the keys and names the Demo seeders have to reproduce. */
function clickdummyCatalog(): array
{
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/config.ts'));

    preg_match_all("/^\s+key: '(\w+)',\s*label: '([^']+)'/m", $source, $properties, PREG_SET_ORDER);
    preg_match_all("/\{ id: 'lb_\w+', name: '([^']+)', color: '(\w+)' \}/", $source, $labels, PREG_SET_ORDER);
    preg_match_all("/\{ id: 'rt_\w+', name: '([^']+)', outward_label: '([^']+)', inward_label: (?:'([^']+)'|null)/", $source, $relations, PREG_SET_ORDER);

    return compact('properties', 'labels', 'relations');
}

it('seeds the people of the clickdummy with their organization roles', function () {
    $this->seed(DemoSeeder::class);
    $people = clickdummySeed()['people'];

    expect($people)->toHaveCount(6);

    foreach ($people as $match) {
        [, $name, $handle] = $match;
        $user = User::where('handle', $handle)->sole();
        $role = $match[3] ?? 'member';

        expect([$user->name, $user->email, $user->type, $user->locale?->value, $user->timezone])
            ->toBe([$name, $handle.'@feldwerk.example.com', AccountType::Person, 'de', 'Europe/Berlin'])
            ->and(Visibility::orgRole($user)->value)->toBe($role);
    }

    expect(User::where('type', AccountType::Person)->count())->toBe(6)
        ->and(User::where('handle', 'mara')->sole()->email)->toBe('mara@feldwerk.example.com');
});

it('disables only Sven, at 17:00 Berlin time on 18 September 2026', function () {
    $this->seed(DemoSeeder::class);
    expect(User::whereNotNull('disabled_at')->pluck('handle')->all())->toBe(['sven'])
        ->and(User::where('handle', 'sven')->sole()->disabled_at->utc()->format('Y-m-d H:i'))->toBe('2026-09-18 15:00');
});

it('names Feldwerk as the organization, in German, with Monday as the first day of the week', function () {
    $this->seed(DemoSeeder::class);
    $organization = Organization::current();

    expect([$organization->name, $organization->locale->value, $organization->timezone, $organization->week_start])->toBe(['Feldwerk', 'de', 'Europe/Berlin', 1]);
});

it('gives the default bot its German description and adds Kira, the bot of Mara', function () {
    $this->seed(DemoSeeder::class);
    $bots = array_column(clickdummySeed()['bots'], null, 1);
    $kira = User::where('handle', 'kira')->sole();

    expect($bots)->toHaveKeys(['automation', 'kira'])
        ->and(User::defaultBot()->description)->toBe($bots['automation'][3])
        ->and(Visibility::orgRole(User::defaultBot()))->toBe(OrgRole::Admin)
        ->and([$kira->type, $kira->name, $kira->description, $kira->email, $kira->is_default_bot])->toBe([AccountType::Bot, 'Kira', $bots['kira'][3], null, false])
        ->and($kira->owner_id)->toBe(User::where('handle', 'mara')->sole()->id)
        ->and(Visibility::orgRole($kira)->value)->toBe($bots['kira'][2])
        ->and(User::where('type', AccountType::Bot)->count())->toBe(2);
});

it('seeds the three projects and their members as in the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    $seed = clickdummySeed();

    expect($seed['projects'])->toHaveCount(3)->and($seed['members'])->toHaveCount(13);

    foreach ($seed['projects'] as [, $identifier, $name, $description, $lead, $visibility]) {
        $project = Project::where('identifier', $identifier)->sole();

        expect([$project->name, $project->description, $project->lead->handle, $project->visibility->value])->toBe([$name, $description, $lead, $visibility]);
    }

    foreach ($seed['members'] as [, $key, $handle, $role]) {
        $project = Project::where('identifier', strtoupper($key))->sole();

        // Not Visibility::roleIn: it makes the org admin Mara an admin everywhere; the table lists the role she is assigned
        expect(app(RoleIndex::class)->projectRoles(User::where('handle', $handle)->sole())[$project->id]->value)->toBe($role);
    }

    expect(ProjectMember::count())->toBe(13);
});

it('keeps OPS private: Ida, Theo and Lene do not see it, Ida still reads WEB and APP', function () {
    $this->seed(DemoSeeder::class);
    $ops = Project::where('identifier', 'OPS')->sole();

    foreach (['ida', 'theo', 'lene'] as $handle) {
        expect(Visibility::roleIn(User::where('handle', $handle)->sole(), $ops))->toBeNull();
    }

    expect(Visibility::roleIn(User::where('handle', 'ida')->sole(), Project::where('identifier', 'APP')->sole())?->value)->toBe('viewer');
});

it('seeds the catalog of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    $seed = clickdummyCatalog();

    expect($seed['properties'])->toHaveCount(9)->and($seed['labels'])->toHaveCount(8)->and($seed['relations'])->toHaveCount(4);

    foreach ($seed['properties'] as [, $key, $label]) {
        expect(Property::where('key', $key)->sole()->label)->toBe($label);
    }

    foreach ($seed['labels'] as [, $name, $color]) {
        expect(Label::where('name', $name)->sole()->color->value)->toBe($color);
    }

    foreach ($seed['relations'] as $match) {
        $relation = RelationType::where('name', $match[1])->sole();

        expect([$relation->outward_label, $relation->inward_label])->toBe([$match[2], $match[3] ?? null]);
    }

    expect(Property::count())->toBe(9)->and(Label::count())->toBe(8)->and(RelationType::count())->toBe(4)
        ->and(RelationType::whereNull('built_in')->sole()->name)->toBe('testet');
});

it('seeds the workflows with the Agentur-Freigabe of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    $standard = Workflow::default();
    $agency = Workflow::where('name', 'Agentur-Freigabe')->with(['states', 'transitions'])->sole();
    $names = $agency->states->pluck('name', 'id');
    $moves = $agency->transitions->map(fn ($transition) => $names[$transition->from_state_id].' > '.$names[$transition->to_state_id])->sort()->values()->all();

    expect(Workflow::orderBy('id')->pluck('name')->all())->toBe(['Standard', 'Agentur-Freigabe'])
        ->and($standard->name)->toBe('Standard')
        ->and($standard->description)->toBe('Der Standard-Workflow: Jeder Status ist von überall erreichbar.')
        ->and([$agency->is_default, $agency->is_free, $agency->description])->toBe([false, false, 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.'])
        ->and($names->values()->all())->toBe(['Backlog', 'Todo', 'In Progress', 'Review', 'Kundenfreigabe', 'Done', 'Cancelled'])
        ->and($agency->states->pluck('category')->map->value->all())->toBe(['backlog', 'unstarted', 'started', 'started', 'started', 'completed', 'canceled'])
        ->and($agency->states->pluck('icon')->map->value->all())->toBe(['dashed', 'circle', 'half', 'three-quarter', 'pause', 'check', 'cross'])
        ->and($names[$agency->initial_state_id])->toBe('Backlog')
        ->and($agency->transitions)->toHaveCount(14)
        ->and($moves)->toContain('Review > Kundenfreigabe', 'Done > Todo', 'Cancelled > Backlog')->not->toContain('Backlog > Done')
        ->and($agency->graph()->issues())->toBe([])
        ->and($standard->graph()->issues())->toBe([]);
});

it('seeds the types with their properties and the German texts of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    $asks = fn (string $name) => WorkItemType::where('name', $name)->sole()->typeProperties()->orderBy('position')->with('property')->get()
        ->mapWithKeys(fn ($row) => [$row->property->key => $row->required])->all();
    $wish = WorkItemType::where('name', 'Kundenwunsch')->sole();

    expect(WorkItemType::orderBy('id')->pluck('name')->all())->toBe(['Task', 'Bug', 'Epic', 'Kundenwunsch'])
        ->and($asks('Task'))->toBe(['customer' => false, 'effort' => false])
        ->and($asks('Bug'))->toBe(['customer' => false, 'effort' => false, 'environment' => true, 'browser' => false, 'steps' => false])
        ->and($asks('Epic'))->toBe(['target_quarter' => false, 'customer' => false])
        ->and($asks('Kundenwunsch'))->toBe(['customer' => true, 'ticket_url' => false, 'approved' => false, 'reviewer' => false])
        ->and([$wish->icon, $wish->tone->value, $wish->is_epic])->toBe(['message-square-heart', 'plum', false])
        ->and(WorkItemType::where('name', 'Bug')->sole()->description)->toBe('Ein Fehler, der behoben werden muss. Die Umgebung, in der er auftritt, ist Pflicht.')
        ->and(WorkItemType::where('name', 'Epic')->sole()->is_epic)->toBeTrue()
        ->and(Property::where('key', 'effort')->sole()->label)->toBe('Aufwand (h)');
});

it('seeds the options and the default of the properties', function () {
    $this->seed(DemoSeeder::class);
    $options = fn (string $key) => Property::where('key', $key)->sole()->options->map(fn ($option) => [$option->label, $option->color->value])->all();

    expect($options('customer'))->toBe([['Studio Nordlicht', 'sky'], ['Hafenkontor', 'ochre'], ['Gärtnerei Moos', 'moss']])
        ->and($options('environment'))->toBe([['Produktion', 'plum'], ['Staging', 'ochre'], ['Lokal', 'slate']])
        ->and($options('target_quarter'))->toBe([['Q4 2026', 'sky'], ['Q1 2027', 'moss'], ['Q2 2027', 'sand']])
        ->and(Property::where('key', 'approved')->sole()->default_value)->toBeFalse()
        ->and(Property::where('key', 'effort')->sole()->settings)->toBe(['decimals' => 1])
        ->and(Property::where('key', 'ticket_url')->sole()->field_type->value)->toBe('url')
        ->and(Property::where('key', 'reviewer')->sole()->field_type->value)->toBe('member')
        ->and(Property::where('key', 'steps')->sole()->field_type->value)->toBe('rich_text');
});

it('gives WEB, APP and OPS their workflow and types', function () {
    $this->seed(DemoSeeder::class);
    $of = fn (string $identifier) => Project::where('identifier', $identifier)->with('workflow')->sole();

    foreach (['WEB' => ['Standard', ['Task', 'Bug', 'Epic']], 'OPS' => ['Standard', ['Task', 'Bug', 'Epic']], 'APP' => ['Agentur-Freigabe', ['Task', 'Bug', 'Epic', 'Kundenwunsch']]] as $identifier => [$workflow, $types]) {
        expect($of($identifier)->workflow->name)->toBe($workflow)
            ->and($of($identifier)->types->pluck('name')->all())->toBe($types)
            ->and($of($identifier)->default_type_id)->toBe(WorkItemType::where('name', 'Task')->sole()->id);
    }
});

it('seeds the catalog again without duplicates', function () {
    $this->seed(DemoSeeder::class);
    $counts = fn () => [Workflow::count(), WorkItemType::count(), Property::count(), Label::count(), RelationType::count(), DB::table('workflow_states')->count(), DB::table('workflow_transitions')->count(), DB::table('property_options')->count(), DB::table('type_properties')->count(), DB::table('project_types')->count()];
    $ids = fn () => [Workflow::orderBy('name')->pluck('id')->all(), WorkItemType::orderBy('name')->pluck('id')->all(), Property::orderBy('key')->pluck('id')->all(), DB::table('property_options')->orderBy('id')->pluck('id')->all(), DB::table('workflow_states')->orderBy('id')->pluck('id')->all()];
    [$before, $idsBefore, $events] = [$counts(), $ids(), Event::count()];

    $this->seed(DemoSeeder::class);

    expect($counts())->toBe($before)->and($before)->toBe([2, 4, 9, 8, 4, 13, 14, 9, 13, 10])
        ->and($ids())->toBe($idsBefore)
        ->and(Event::count())->toBe($events);
});

it('seeds the project favorites with the positions of the clickdummy', function () {
    $this->seed(DemoSeeder::class);
    $projects = Project::pluck('identifier', 'id');
    $of = fn (string $handle) => Favorite::where('user_id', User::where('handle', $handle)->sole()->id)->orderBy('position')->get()
        ->mapWithKeys(fn (Favorite $favorite) => [$projects[$favorite->favoritable_id] => $favorite->position])->all();

    expect($of('mara'))->toBe(['WEB' => 3, 'APP' => 4, 'OPS' => 5])
        ->and($of('jonas'))->toBe(['OPS' => 1, 'WEB' => 2])
        ->and($of('ida'))->toBe(['WEB' => 1])
        ->and($of('theo'))->toBe(['APP' => 1])
        ->and($of('lene'))->toBe(['WEB' => 0, 'APP' => 1])
        ->and($of('sven'))->toBe([])
        ->and(Favorite::where('favoritable_type', 'project')->count())->toBe(9);
});

it('seeds the tokens of Mara and Kira with their times in UTC and a secret nobody knows', function () {
    $this->seed(DemoSeeder::class);
    $token = fn (string $name) => PersonalAccessToken::where('name', $name)->sole();
    $times = fn (PersonalAccessToken $token) => [$token->created_at->utc()->format('Y-m-d H:i'), $token->last_used_at->utc()->format('Y-m-d H:i'), $token->expires_at?->utc()->format('Y-m-d H:i')];

    expect($token('Claude Code')->tokenable->handle)->toBe('mara')
        ->and($token('Claude Code')->abilities)->toBe(['read', 'write', 'mcp'])
        ->and($times($token('Claude Code')))->toBe(['2026-10-02 09:00', '2026-10-28 08:05', null])
        ->and($token('CI-Skript')->tokenable->handle)->toBe('mara')
        ->and($token('CI-Skript')->abilities)->toBe(['read'])
        ->and($times($token('CI-Skript')))->toBe(['2026-06-30 08:00', '2026-09-29 20:15', '2026-09-30 21:59'])
        ->and($token('MCP')->tokenable->handle)->toBe('kira')
        ->and($token('MCP')->abilities)->toBe(['read', 'write', 'mcp'])
        ->and($times($token('MCP')))->toBe(['2026-10-05 12:30', '2026-10-27 08:41', null])
        ->and(PersonalAccessToken::pluck('token')->unique())->toHaveCount(3);
});

it('runs again without changing anything and resets the demo password', function () {
    $this->seed(DemoSeeder::class);
    $secrets = PersonalAccessToken::orderBy('name')->pluck('token', 'name')->all();
    $counts = fn () => [User::count(), Project::count(), ProjectMember::count(), Favorite::count(), PersonalAccessToken::count()];
    $before = $counts();
    User::where('handle', 'lene')->sole()->update(['password' => 'changed-elsewhere']);

    $this->seed(DemoSeeder::class);

    expect($counts())->toBe($before)->and($before)->toBe([8, 3, 13, 9, 3])
        ->and(PersonalAccessToken::orderBy('name')->pluck('token', 'name')->all())->toBe($secrets)
        ->and(Hash::check(DemoSeeder::PASSWORD, User::where('handle', 'lene')->sole()->password))->toBeTrue()
        ->and(Visibility::roleIn(User::where('handle', 'theo')->sole(), Project::where('identifier', 'WEB')->sole())?->value)->toBe('viewer');
});

it('seeds the demo data through the database seeder', function () {
    $this->seed(DatabaseSeeder::class);

    expect(User::where('type', AccountType::Person)->count())->toBe(6);
});

it('seeds nothing through the database seeder in production', function () {
    $this->app['env'] = 'production';
    (new DatabaseSeeder)->run();

    expect(User::where('type', AccountType::Person)->count())->toBe(0);
});

it('refuses production', function () {
    $this->app['env'] = 'production';
    // Called directly: db:seed itself asks for a confirmation in production.
    expect(fn () => (new DemoSeeder)->run())->toThrow(RuntimeException::class)
        ->and(fn () => app()->call([new E2eSeeder, 'run']))->toThrow(RuntimeException::class)
        ->and(User::where('type', AccountType::Person)->count())->toBe(0);
});
