<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Favorites\ListFavorites;
use App\Actions\Invitations\ListInvitations;
use App\Actions\Labels\ListLabels;
use App\Actions\Notifications\ListNotifications;
use App\Actions\Pages\ListPageVersions;
use App\Actions\Projects\ListMembers;
use App\Actions\Projects\ListProjects;
use App\Actions\Properties\ListProperties;
use App\Actions\RelationTypes\ListRelationTypes;
use App\Actions\Resolutions\ListResolutions;
use App\Actions\Templates\ListTemplateRuns;
use App\Actions\Templates\ListTemplates;
use App\Actions\Tokens\ListTokens;
use App\Actions\Users\ListUsers;
use App\Actions\Views\ListViews;
use App\Actions\Webhooks\ListWebhookDeliveries;
use App\Actions\Webhooks\ListWebhooks;
use App\Actions\Workflows\ListWorkflows;
use App\Actions\WorkItems\ListHistory;
use App\Actions\WorkItemTypes\ListWorkItemTypes;
use App\Domain\Notifications\NotificationKind;
use App\Models\Invitation;
use App\Models\Label;
use App\Models\Notification;
use App\Models\Project;
use App\Models\Resolution;
use App\Models\Template;
use App\Models\User;
use App\Models\View;
use App\Models\Webhook;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * The rules of every plain list (Task 5, A386, K7, K11, K13): each one filters and sorts by its `ListSpec`, passes over
 * the parameters it had before, keeps its order without a `sort`, and answers a filter on something hidden like an
 * unknown id (Review Focus 5).
 */

/** The names of a list's rows, in its order. */
$names = fn ($response, string $key = 'name'): array => array_column($response->assertOk()->json('data'), $key);

/** Every list action with a `ListSpec` and the table its sorts name. */
$specs = [
    [ListUsers::class, 'spec'], [ListUsers::class, 'botSpec'], [ListInvitations::class, 'spec'], [ListTokens::class, 'spec'],
    [ListProjects::class, 'spec'], [ListMembers::class, 'spec'], [ListWorkflows::class, 'spec'], [ListWorkItemTypes::class, 'spec'],
    [ListProperties::class, 'spec'], [ListLabels::class, 'spec'], [ListRelationTypes::class, 'spec'], [ListResolutions::class, 'spec'],
    [ListViews::class, 'spec'], [ListTemplates::class, 'spec'], [ListTemplates::class, 'projectSpec'], [ListWebhooks::class, 'spec'],
    [ListWebhookDeliveries::class, 'spec'], [ListNotifications::class, 'spec'],
    [ListFavorites::class, 'spec'], [ListHistory::class, 'spec'], [ListPageVersions::class, 'spec'], [ListTemplateRuns::class, 'spec'],
];

it('sorts only by columns that are never null', function () use ($specs) {
    foreach ($specs as [$action, $method]) {
        foreach ($action::$method()->sorts as $name => $column) {
            // an alias of the select (`sort_name`, `attempted_cursor`) is the action's own business
            if (! str_contains($column, '.')) {
                continue;
            }
            [$table, $field] = explode('.', $column);
            $nullable = collect(Schema::getColumns($table))->firstWhere('name', $field)['nullable'] ?? null;
            expect($nullable)->toBeFalse("{$action}::{$method} sorts by {$column}");
        }
    }
});

it('lists the users by type, name and handle, and the bots by owner', function () use ($names) {
    $admin = User::factory()->admin()->create(['name' => 'Zora', 'handle' => 'zora']);
    $ada = User::factory()->create(['name' => 'Ada', 'handle' => 'ada']);
    $bot = User::factory()->bot($admin)->create(['name' => 'Bob Bot', 'handle' => 'bob']);
    $gone = User::factory()->disabled()->create(['name' => 'Gone', 'handle' => 'gone']);
    $this->actingAs($admin);

    // the default: people first, then the ULID
    $default = $this->getJson('/api/v1/users')->assertOk()->json('data.*.type');
    expect($default)->toBe(collect($default)->sortByDesc(fn ($type) => $type)->values()->all());

    expect($names($this->getJson('/api/v1/users?filter[type]=bot&sort=name')))->toContain('Bob Bot')->not->toContain('Ada')
        ->and($names($this->getJson('/api/v1/users?filter[type]=person&sort=-name')))->toBe(['Zora', 'Gone', 'Ada'])
        ->and($names($this->getJson('/api/v1/users?filter[disabled]=1')))->toBe(['Gone'])
        ->and($names($this->getJson('/api/v1/users?filter[type]=person&filter[disabled]=0&sort=handle')))->toBe(['Ada', 'Zora'])
        ->and($names($this->getJson("/api/v1/bots?filter[owner_id]={$admin->id}")))->toBe(['Bob Bot'])
        ->and($names($this->getJson('/api/v1/bots?filter[owner_id]='.strtoupper($admin->id))))->toBe(['Bob Bot'])
        ->and($names($this->getJson("/api/v1/bots?filter[owner_id]={$ada->id}")))->toBe([]);
    // a bot list holds bots only; `type` is no filter of it
    $this->getJson('/api/v1/bots?filter[type]=person')->assertUnprocessable()->assertJsonValidationErrors(['filter']);
    // the old parameter is passed over
    expect($names($this->getJson('/api/v1/users?type=bot&sort=name')))->toContain('Ada', 'Bob Bot');
    unset($bot, $gone);
});

it('filters invitations by role and sorts them by expiry', function () {
    $admin = User::factory()->admin()->create();
    $later = Invitation::factory()->create(['email' => 'later@example.com', 'org_role' => 'member', 'expires_at' => now()->addDays(6)]);
    $sooner = Invitation::factory()->create(['email' => 'sooner@example.com', 'org_role' => 'admin', 'expires_at' => now()->addDays(2)]);
    $this->actingAs($admin);

    expect($this->getJson('/api/v1/invitations?filter[org_role]=admin')->assertOk()->json('data.*.email'))->toBe(['sooner@example.com'])
        ->and($this->getJson('/api/v1/invitations?sort=expires_at')->json('data.*.email'))->toBe(['sooner@example.com', 'later@example.com'])
        ->and($this->getJson('/api/v1/invitations?sort=-expires_at')->json('data.*.email'))->toBe(['later@example.com', 'sooner@example.com']);
    unset($later, $sooner);
});

it('finds the tokens of a bot by an upper-case ULID', function () {
    $admin = User::factory()->admin()->create();
    $bot = User::factory()->bot($admin)->create();
    $bot->createToken('CI', ['read']);
    $admin->createToken('Mine', ['read']);
    $this->actingAs($admin);

    expect($this->getJson('/api/v1/tokens?filter[user_id]='.strtoupper($bot->id))->assertOk()->json('data.*.name'))->toBe(['CI'])
        ->and($this->getJson('/api/v1/tokens')->json('data.*.name'))->toBe(['Mine'])
        // the old parameter is passed over: the own tokens
        ->and($this->getJson("/api/v1/tokens?user_id={$bot->id}")->json('data.*.name'))->toBe(['Mine']);
    $this->getJson('/api/v1/tokens?filter[user_id]=nobody')->assertNotFound();
    $this->getJson('/api/v1/tokens?filter[user_id]='.strtolower((string) Str::ulid()))->assertNotFound();

    // creating takes the owner from the body, in any case
    $this->postJson('/api/v1/tokens', ['user_id' => strtoupper($bot->id), 'name' => 'New', 'abilities' => ['read']])->assertCreated()
        ->assertJsonPath('token.user_id', $bot->id);
    $this->postJson('/api/v1/tokens', ['user_id' => 'nobody', 'name' => 'New', 'abilities' => ['read']])->assertNotFound();
});

it('sorts the tokens by name', function () {
    $admin = User::factory()->admin()->create();
    $admin->createToken('Zeta', ['read']);
    $admin->createToken('Alpha', ['read']);
    $this->actingAs($admin);

    expect($this->getJson('/api/v1/tokens?sort=name')->json('data.*.name'))->toBe(['Alpha', 'Zeta'])
        ->and($this->getJson('/api/v1/tokens')->json('data.*.name'))->toBe(['Zeta', 'Alpha']);
});

it('filters the projects and loads their members', function () use ($names) {
    $lene = User::factory()->create(['name' => 'Lene']);
    $kira = User::factory()->create(['name' => 'Kira']);
    $web = Project::factory()->identifier('WEB')->public()->create(['name' => 'Website', 'lead_id' => $lene->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($kira, ProjectRole::Admin)->create(['name' => 'Betrieb', 'lead_id' => $kira->id]);
    app(RoleAssignments::class)->setProjectRole($lene, $ops, ProjectRole::Member);
    $this->actingAs($lene);

    expect($names($this->getJson('/api/v1/projects?filter[visibility]=private')))->toBe(['Betrieb'])
        ->and($names($this->getJson("/api/v1/projects?filter[lead_id]={$lene->id}")))->toBe(['Website'])
        ->and($names($this->getJson('/api/v1/projects?sort=-identifier')))->toBe(['Website', 'Betrieb'])
        ->and($names($this->getJson('/api/v1/projects')))->toBe(['Betrieb', 'Website'])
        ->and($names($this->getJson("/api/v1/projects?filter[workflow_id]={$web->workflow_id}")))->toBe(['Betrieb', 'Website']);

    // member: the account is a member of the project, not just able to see it
    $outsider = User::factory()->create();
    $this->actingAs($outsider);
    expect($names($this->getJson('/api/v1/projects?filter[member]=0')))->toBe(['Website'])
        ->and($names($this->getJson('/api/v1/projects?filter[member]=1')))->toBe([]);
    $this->actingAs($lene);
    expect($names($this->getJson('/api/v1/projects?filter[member]=1')))->toBe(['Betrieb']);

    // include=members: the memberships as GET …/members gives them
    $included = $this->getJson('/api/v1/projects?include=members&filter[visibility]=private')->assertOk()->json('data.0.members');
    $listed = $this->getJson('/api/v1/projects/OPS/members')->json('data');
    expect($included)->toBe($listed)->and($included)->toHaveCount(2);
    expect($this->getJson('/api/v1/projects')->json('data.0'))->not->toHaveKey('members');
});

it('includes the members only of visible projects, with as many queries for 5 as for 50 projects', function () {
    $lene = User::factory()->create();
    $secret = Project::factory()->identifier('SEC')->private()->create();
    Project::factory()->identifier('PUB')->public()->create();
    $this->actingAs($lene);

    $response = $this->getJson('/api/v1/projects?include=members')->assertOk();
    expect($response->json('data.*.identifier'))->toBe(['PUB'])->and($response->getContent())->not->toContain($secret->id);

    $count = function () {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/api/v1/projects?include=members')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };
    Project::factory()->count(4)->public()->create();
    $five = $count();
    Project::factory()->count(45)->public()->create();

    expect($count())->toBe($five);
});

it('answers a filter on something hidden like an unknown id', function () use ($names) {
    $lene = User::factory()->create();
    $kira = User::factory()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create(['name' => 'Betrieb', 'lead_id' => $kira->id]);
    $web = Project::factory()->identifier('WEB')->public()->create(['name' => 'Website']);
    Template::factory()->create(['project_id' => $ops->id, 'name' => 'Geheim']);
    $this->actingAs($lene);

    $unknown = strtolower((string) Str::ulid());
    foreach (['projects?filter[lead_id]=', 'templates?filter[project_id]='] as $path) {
        $hidden = $this->getJson("/api/v1/{$path}".($path === 'projects?filter[lead_id]=' ? $kira->id : $ops->id));
        $none = $this->getJson("/api/v1/{$path}{$unknown}");
        expect($hidden->assertOk()->json('data'))->toBe([])->and($hidden->json('meta.total'))->toBe($none->json('meta.total'));
    }
    // a project in deletion is no project to a filter on webhooks
    $admin = User::factory()->admin()->create();
    $going = Project::factory()->identifier('GON')->public()->create();
    Webhook::factory()->forProject($going)->create(['name' => 'Going']);
    Webhook::factory()->forProject($web)->create(['name' => 'Staying']);
    $going->forceFill(['deleting_at' => now()])->save();
    $this->actingAs($admin);
    expect($names($this->getJson("/api/v1/webhooks?filter[project_id]={$going->id}")))->toBe([])
        ->and($names($this->getJson("/api/v1/webhooks?filter[project_id]={$web->id}")))->toBe(['Staying']);
});

it('lists the members of a project sorted by name and filtered by type', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $zora = memberOf($web, ProjectRole::Member, ['name' => 'Zora']);
    $ada = memberOf($web, ProjectRole::Admin, ['name' => 'Ada']);
    $bot = User::factory()->bot()->create(['name' => 'Bot']);
    app(RoleAssignments::class)->setProjectRole($bot, $web, ProjectRole::Member);
    $this->actingAs($zora);

    // the default: the order they joined
    $joined = $this->getJson('/api/v1/projects/WEB/members')->assertOk()->json('data.*.user_id');
    expect($joined)->toContain($zora->id, $ada->id, $bot->id);
    $byName = fn (string $query) => $this->getJson("/api/v1/projects/WEB/members?{$query}")->assertOk()->json('data.*.user_id');

    expect($byName('sort=name'))->toBe([$ada->id, $bot->id, $zora->id])
        ->and($byName('sort=-name'))->toBe([$zora->id, $bot->id, $ada->id])
        ->and($byName('filter[type]=bot'))->toBe([$bot->id])
        ->and($byName('filter[type]=person&sort=name'))->toBe([$ada->id, $zora->id]);
    // a role lives in spatie: it is no filter
    $this->getJson('/api/v1/projects/WEB/members?filter[role]=admin')->assertUnprocessable()->assertJsonValidationErrors(['filter']);
    // a cursor pages through the name order
    $first = $this->getJson('/api/v1/projects/WEB/members?sort=name&per_page=2')->assertOk();
    expect($first->json('data.*.user_id'))->toBe([$ada->id, $bot->id])
        ->and($this->getJson('/api/v1/projects/WEB/members?sort=name&per_page=2&cursor='.$first->json('meta.next_cursor'))->json('data.*.user_id'))->toBe([$zora->id]);
});

it('filters and sorts the catalogs', function () use ($names) {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);
    Label::factory()->create(['name' => 'Zebra']);
    Label::factory()->create(['name' => 'Apfel']);
    expect($names($this->getJson('/api/v1/labels?filter[name]=pfe')))->toBe(['Apfel'])
        ->and($names($this->getJson('/api/v1/labels?sort=name')))->toBe(['Apfel', 'Zebra'])
        ->and($names($this->getJson('/api/v1/labels?sort=-name')))->toBe(['Zebra', 'Apfel'])
        ->and($names($this->getJson('/api/v1/labels')))->toBe(['Zebra', 'Apfel']);

    expect($names($this->getJson('/api/v1/work-item-types?filter[is_epic]=1')))->toBe(['Epic'])
        ->and($names($this->getJson('/api/v1/work-item-types?filter[name]=ug')))->toBe(['Bug']);
    WorkItemType::query()->where('name', 'Bug')->update(['archived_at' => now()]);
    expect($names($this->getJson('/api/v1/work-item-types?filter[archived]=1')))->toBe(['Bug'])
        ->and($names($this->getJson('/api/v1/work-item-types?filter[archived]=0&sort=name')))->toBe(['Epic', 'Task'])
        // the catalog order, the shipped Task, Bug and Epic first
        ->and($names($this->getJson('/api/v1/work-item-types')))->toBe(['Task', 'Bug', 'Epic']);

    expect($names($this->getJson('/api/v1/workflows?filter[name]=standard')))->toBe(['Standard'])
        ->and($names($this->getJson('/api/v1/workflows?filter[name]=nope')))->toBe([]);

    expect($names($this->getJson('/api/v1/relation-types?filter[built_in]=1&sort=name')))->toBe(['blocks', 'Duplicate', 'related'])
        ->and($names($this->getJson('/api/v1/relation-types?filter[built_in]=0')))->toBe([]);

    expect($names($this->getJson('/api/v1/properties?filter[field_type]=number'), 'key'))->toBe(['effort'])
        ->and($names($this->getJson('/api/v1/properties?filter[label]=ffort'), 'key'))->toBe(['effort'])
        ->and($names($this->getJson('/api/v1/properties?sort=key'), 'key'))->toBe(['effort']);
});

it('filters and sorts the resolutions', function () {
    $this->actingAs(User::factory()->create());
    Resolution::factory()->archived()->create(['label' => 'Old', 'position' => 9]);
    $label = fn (string $query) => $this->getJson("/api/v1/resolutions?{$query}")->assertOk()->json('data.*.label');

    expect($label('filter[default_for]=completed'))->toBe(['Done'])
        ->and($label('filter[archived]=1'))->toBe(['Old'])
        ->and($label('filter[archived]=0&sort=label'))->toBe(['Cannot reproduce', 'Done', 'Duplicate', "Won't do"])
        ->and($label(''))->toBe(['Done', "Won't do", 'Duplicate', 'Cannot reproduce', 'Old']);
});

it('filters and sorts the views', function () use ($names) {
    $lene = User::factory()->create();
    $kira = User::factory()->create();
    View::factory()->create(['name' => 'Beta', 'created_by' => $lene->id]);
    View::factory()->create(['name' => 'Alpha', 'created_by' => $kira->id]);
    $this->actingAs($lene);

    expect($names($this->getJson("/api/v1/views?filter[created_by]={$kira->id}")))->toBe(['Alpha'])
        ->and($names($this->getJson('/api/v1/views?filter[name]=bet')))->toBe(['Beta'])
        ->and($names($this->getJson('/api/v1/views?sort=-name')))->toBe(['Beta', 'Alpha'])
        ->and($names($this->getJson('/api/v1/views')))->toBe(['Alpha', 'Beta']);
});

it('filters the templates by project and schedule, the old parameter is passed over', function () use ($names) {
    $lene = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->public()->create();
    $app = Project::factory()->identifier('APP')->public()->create();
    Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung']);
    Template::factory()->scheduled([
        'frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00',
        'starts_on' => '2026-09-01', 'ends' => ['type' => 'never'], 'paused' => false,
    ])->create(['project_id' => $app->id, 'name' => 'Bericht']);
    $this->actingAs($lene);

    expect($names($this->getJson("/api/v1/templates?filter[project_id]={$app->id}")))->toBe(['Bericht'])
        ->and($names($this->getJson('/api/v1/templates?filter[scheduled]=1')))->toBe(['Bericht'])
        ->and($names($this->getJson('/api/v1/templates?filter[scheduled]=0')))->toBe(['Wartung'])
        ->and($names($this->getJson('/api/v1/templates?sort=-name')))->toBe(['Wartung', 'Bericht'])
        ->and($names($this->getJson('/api/v1/templates')))->toBe(['Bericht', 'Wartung'])
        // the old parameter is passed over
        ->and($names($this->getJson('/api/v1/templates?project=WEB')))->toBe(['Bericht', 'Wartung'])
        // a project by its identifier is the nested list
        ->and($names($this->getJson('/api/v1/projects/WEB/templates')))->toBe(['Wartung']);
    // `project_id` is a filter of the list across projects only
    $this->getJson('/api/v1/projects/WEB/templates?filter[project_id]='.$app->id)->assertUnprocessable()->assertJsonValidationErrors(['filter']);
    // lean stays a parameter of its own
    expect(array_keys($this->getJson('/api/v1/templates?lean=1')->json('data.0.payload')))->not->toContain('description');
});

it('filters the webhooks and their deliveries', function () use ($names) {
    $admin = User::factory()->admin()->create();
    $bot = User::factory()->bot()->create();
    $web = Project::factory()->identifier('WEB')->public()->create();
    Webhook::factory()->create(['name' => 'Org']);
    $project = Webhook::factory()->forProject($web)->create(['name' => 'Projekt']);
    Webhook::factory()->forBot($bot)->disabled()->create(['name' => 'Bot']);
    $this->actingAs($admin);

    expect($names($this->getJson("/api/v1/webhooks?filter[project_id]={$web->id}")))->toBe(['Projekt'])
        ->and($names($this->getJson('/api/v1/webhooks?filter[active]=0')))->toBe(['Bot'])
        ->and($names($this->getJson("/api/v1/webhooks?filter[bot_id]={$bot->id}")))->toBe(['Bot'])
        ->and($names($this->getJson('/api/v1/webhooks?sort=-name')))->toBe(['Projekt', 'Org', 'Bot'])
        ->and($names($this->getJson('/api/v1/webhooks')))->toBe(['Bot', 'Org', 'Projekt']);

    $created = WebhookDelivery::factory()->create(['webhook_id' => $project->id, 'event' => 'work_item.created']);
    $moved = WebhookDelivery::factory()->create(['webhook_id' => $project->id, 'event' => 'work_item.state_changed']);
    $ok = WebhookAttempt::factory()->create(['delivery_id' => $created->id, 'kind' => WebhookAttempt::SCHEDULED, 'attempted_at' => now()->subMinutes(3)]);
    $failed = WebhookAttempt::factory()->status(500)->create(['delivery_id' => $moved->id, 'kind' => WebhookAttempt::MANUAL, 'attempted_at' => now()->subMinutes(2)]);
    $silent = WebhookAttempt::factory()->noAnswer('timeout')->create(['delivery_id' => $moved->id, 'kind' => WebhookAttempt::PING, 'attempted_at' => now()->subMinute()]);
    $ids = fn (string $query) => $this->getJson("/api/v1/webhooks/{$project->id}/deliveries?{$query}")->assertOk()->json('data.*.id');

    expect($ids(''))->toBe([$silent->id, $failed->id, $ok->id])
        ->and($ids('filter[event]=work_item.created'))->toBe([$ok->id])
        ->and($ids('filter[kind]=manual,ping'))->toBe([$silent->id, $failed->id])
        ->and($ids('filter[succeeded]=1'))->toBe([$ok->id])
        ->and($ids('filter[succeeded]=0'))->toBe([$silent->id, $failed->id])
        ->and($ids(''))->toBe([$silent->id, $failed->id, $ok->id]);
    // a fixed order: `sort` is unknown here
    $this->getJson("/api/v1/webhooks/{$project->id}/deliveries?sort=attempted_at")->assertUnprocessable()->assertJsonValidationErrors(['sort']);
    $this->getJson("/api/v1/webhooks/{$project->id}/deliveries?filter[kind]=nope")->assertUnprocessable()->assertJsonValidationErrors(['filter.kind']);
});

it('filters the inbox by unread and by event, the old parameters are passed over', function () {
    $mara = User::factory()->create();
    $item = WorkItem::factory()->create();
    $read = Notification::factory()->forItem($item)->read()->create(['user_id' => $mara->id, 'created_at' => now()->subMinutes(3)]);
    $mention = Notification::factory()->forItem($item)->kind(NotificationKind::Mentioned, ['source' => 'description'])->create(['user_id' => $mara->id, 'created_at' => now()->subMinutes(2)]);
    $changed = Notification::factory()->forItem($item)->create(['user_id' => $mara->id, 'created_at' => now()->subMinute()]);
    $this->actingAs($mara);
    $ids = fn (string $query) => $this->getJson("/api/v1/notifications?{$query}")->assertOk()->json('data.*.id');

    expect($ids(''))->toBe([$changed->id, $mention->id, $read->id])
        ->and($ids('filter[unread]=1'))->toBe([$changed->id, $mention->id])
        ->and($ids('filter[unread]=0'))->toBe([$read->id])
        ->and($ids('filter[event]=mentioned'))->toBe([$mention->id])
        ->and($ids('filter[event]=mentioned,item_changed&filter[unread]=1'))->toBe([$changed->id, $mention->id])
        // the old parameters are passed over
        ->and($ids('unread_only=1&mentions_only=1'))->toBe([$changed->id, $mention->id, $read->id]);
    $this->getJson('/api/v1/notifications?filter[event]=nope')->assertUnprocessable()->assertJsonValidationErrors(['filter.event']);
    $this->getJson('/api/v1/notifications?filter[unread]=yes')->assertUnprocessable()->assertJsonValidationErrors(['filter.unread']);
});

it('keeps the fixed lists fixed', function () {
    $lene = User::factory()->create();
    $this->actingAs($lene);
    $item = WorkItem::factory()->create();
    $web = $item->project;
    app(RoleAssignments::class)->setProjectRole($lene, $web, ProjectRole::Member);

    foreach (['/api/v1/favorites', "/api/v1/work-items/{$item->id}/comments", "/api/v1/work-items/{$item->id}/history"] as $path) {
        $this->getJson($path)->assertOk();
        $this->getJson("{$path}?sort=name")->assertUnprocessable()->assertJsonValidationErrors(['sort']);
        $this->getJson("{$path}?filter[x]=1")->assertUnprocessable()->assertJsonValidationErrors(['filter']);
        $this->getJson("{$path}?include=x")->assertUnprocessable()->assertJsonValidationErrors(['include']);
    }
});

it('keeps the order of every list when no sort is sent', function () use ($names) {
    // the ULID order of the catalogs, the order they were made in: the page of a cursor leads on in it
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);
    $labels = collect(['M', 'C', 'X', 'A'])->map(fn (string $name) => Label::factory()->create(['name' => $name]))->sortBy('id')->pluck('name')->all();

    expect($names($this->getJson('/api/v1/labels')))->toBe($labels);
    $first = $this->getJson('/api/v1/labels?per_page=2')->assertOk();
    expect($names($this->getJson('/api/v1/labels?per_page=2&cursor='.$first->json('meta.next_cursor'))))->toBe(array_slice($labels, 2));
    // a cursor belongs to its sort
    $this->getJson('/api/v1/labels?sort=name&per_page=2&cursor='.$first->json('meta.next_cursor'))->assertUnprocessable()->assertJsonValidationErrors(['cursor']);
});

it('leaves no client, spec or doc with a parameter the lists passed over (K10)', function () {
    $old = ['unread_only=', 'mentions_only=', '?type=', '&type=', '?user_id=', '&user_id=', 'templates?project='];
    $found = [];
    foreach (['resources/js', 'e2e/tests', 'docs/en', 'docs/de'] as $directory) {
        foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(repo_path($directory), FilesystemIterator::SKIP_DOTS)) as $file) {
            if (! preg_match('/\.(ts|tsx|md)$/', $file->getFilename()) || str_contains($file->getPathname(), 'node_modules') || str_contains($file->getPathname(), '.vitepress')) {
                continue;
            }
            foreach ($old as $needle) {
                if (str_contains((string) file_get_contents($file->getPathname()), $needle)) {
                    $found[] = $file->getPathname().' '.$needle;
                }
            }
        }
    }

    expect($found)->toBe([]);
});

it('reads the memberships of the page for include=members only', function () {
    $lene = User::factory()->create();
    Project::factory()->count(3)->public()->create();
    $this->actingAs($lene);
    $memberQueries = function (string $query) {
        Visibility::forget(); // a request of its own: nothing read yet
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/api/v1/projects'.$query)->assertOk();
        $log = collect(DB::getQueryLog())->pluck('query');
        DB::disableQueryLog();

        // the members of all projects of the page: the roles query that names the teams of several projects
        return $log->filter(fn (string $sql) => str_contains($sql, '`roles`.`name` in (?, ?, ?)') && str_contains($sql, '`model_has_roles`.`team_id` in'))->count();
    };

    expect($memberQueries('?include=members'))->toBeGreaterThan(0)
        ->and($memberQueries(''))->toBe(0);
});

it('asks as often for 5 projects as for 50 without include', function () {
    $this->actingAs(User::factory()->create());
    $count = function () {
        Visibility::forget();
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->getJson('/api/v1/projects')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };
    Project::factory()->count(5)->public()->create();
    $count();
    $five = $count();
    Project::factory()->count(45)->public()->create();

    expect($count())->toBe($five);
});
