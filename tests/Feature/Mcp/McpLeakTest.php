<?php

use App\Access\ProjectRole;
use App\Actions\Pages\CreatePage;
use App\Actions\WorkItems\AddRelation;
use App\Actions\WorkItems\UpdateWorkItem;
use App\Models\Attachment;
use App\Models\Comment;
use App\Models\Favorite;
use App\Models\Notification;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\RelationType;
use App\Models\Template;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemType;
use App\Search\SearchIndexer;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\Support\Mcp\McpClient;
use Tests\TestCase;

/*
 * The adversarial side of the acceptance of phase 13 (task 12, K13): what a token sees over MCP that it must not.
 * Ida is a member of the public WEB and an outsider of the private OPS; Mara is a member of both, Olaf only of OPS.
 * Every call Ida makes on something of OPS has to answer exactly what the same call answers for an id nobody has
 * (`NOPE`, `NOPE-1`, a fresh ULID): no status, reason or sentence tells that it exists. Every refusal has its positive
 * counterpart: the same call by someone who sees OPS gets a real result, so the refusal is the visibility and nothing
 * else. Lists and the search show Ida all of WEB and nothing of OPS; a relation, a reference and a history entry show
 * the hidden end without key, title or id; secrets leave only where REST shows them once, and an invitation link only
 * for a token that may write.
 */

const LEAK_UNKNOWN_ULID = '01jbz7m0000000000000000000';

beforeEach(function () {
    Storage::fake('local');
    resolver(['receiver.example.com' => ['93.184.216.34']]);
    Http::fake(['https://receiver.example.com/*' => Http::response('ok')]);
});

/**
 * WEB (public: Mara admin, Ida member) and OPS (private: Mara admin, Olaf and Paul members) with an item of each kind,
 * a comment, an image and a file, a page with a version, a template and a view on OPS; WEB-1 relates to OPS-1 and names
 * OPS-1 and the OPS page in its description, the WEB page names them too. Ida has a notification and a favorite in each
 * project (she was a member of OPS once). The search index holds all of it.
 *
 * @return array<string, mixed>
 */
$world = function (): array {
    searchEngine();
    $admin = User::factory()->admin()->create(['name' => 'Erik Ende', 'handle' => 'erik']);
    $mara = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $ida = User::factory()->create(['name' => 'Ida Innen', 'handle' => 'ida']);
    $olaf = User::factory()->create(['name' => 'Olaf Ops', 'handle' => 'olaf']);
    $paul = User::factory()->create(['name' => 'Paul Ops', 'handle' => 'paul']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->member($ida, ProjectRole::Member)
        ->create(['name' => 'Website', 'lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->private()->member($mara, ProjectRole::Admin)->member($olaf, ProjectRole::Member)->member($paul, ProjectRole::Member)
        ->create(['name' => 'Geheimbetrieb', 'lead_id' => $mara->id]);

    $webItem = WorkItem::factory()->for($web)->create(['title' => 'Öffentlicher Server Status', 'created_by' => $mara->id]);
    $opsItem = WorkItem::factory()->for($ops)->create(['title' => 'Geheimer Server Schlüssel', 'created_by' => $mara->id]);
    $opsOther = WorkItem::factory()->for($ops)->create(['title' => 'Zweites Geheimnis', 'created_by' => $mara->id]);
    $opsClosed = WorkItem::factory()->for($ops)->closed()->create(['created_by' => $mara->id]);
    $opsArchived = WorkItem::factory()->for($ops)->archived()->create(['created_by' => $mara->id]);

    $opsPage = Page::factory()->create(['project_id' => $ops->id, 'title' => 'Geheime Seite', 'created_by' => $mara->id, 'updated_by' => $mara->id]);
    $opsVersion = PageVersion::factory()->create(['page_id' => $opsPage->id]);
    $opsParent = Page::factory()->create(['project_id' => $ops->id, 'title' => 'Geheimer Ordner', 'created_by' => $mara->id, 'updated_by' => $mara->id]);

    // the relation below is Mara's own: the automation link_references would make it from the reference first (A452)
    withoutReferenceLinks();
    UpdateWorkItem::run(actor($mara), $webItem, ['description' => "Hängt an OPS-1 und [Plan](page:{$opsPage->id})."]);
    AddRelation::run(actor($mara), $webItem, ['type_id' => RelationType::query()->where('built_in', 'relates')->value('id'), 'target_id' => 'OPS-1']);
    $webPage = CreatePage::run(actor($mara), $web, ['title' => 'Öffentliche Seite', 'content' => "Siehe OPS-1 und [Plan](page:{$opsPage->id})."]);
    $webFolder = Page::factory()->create(['project_id' => $web->id, 'title' => 'Öffentlicher Ordner', 'created_by' => $mara->id, 'updated_by' => $mara->id]);

    $opsView = View::factory()->create(['name' => 'Betrieb', 'created_by' => $mara->id, 'filter' => ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $ops->id]]]]);

    $notify = fn (WorkItem $item) => Notification::factory()->forItem($item)->create(['user_id' => $ida->id]);
    $favor = fn (Project $project, int $position) => Favorite::factory()->create(['user_id' => $ida->id, 'favoritable_type' => $project->getMorphClass(), 'favoritable_id' => $project->id, 'position' => $position]);
    $favor($ops, 0);
    $favor($web, 1);

    $world = [
        'admin' => $admin, 'mara' => $mara, 'ida' => $ida, 'olaf' => $olaf, 'paul' => $paul,
        'web' => $web, 'ops' => $ops,
        'webItem' => $webItem, 'opsItem' => $opsItem, 'opsOther' => $opsOther, 'opsClosed' => $opsClosed, 'opsArchived' => $opsArchived,
        'opsComment' => Comment::factory()->for($opsItem, 'workItem')->create(['author_id' => $mara->id]),
        'webComment' => Comment::factory()->for($webItem, 'workItem')->create(['author_id' => $mara->id]),
        'opsImage' => Attachment::factory()->forItem($opsItem)->stored('geheim', 'image/png', 'geheim.png')->create(['uploaded_by' => $mara->id]),
        'webImage' => Attachment::factory()->forItem($webItem)->stored('offen', 'image/png', 'offen.png')->create(['uploaded_by' => $mara->id]),
        'opsPage' => $opsPage, 'opsVersion' => $opsVersion, 'opsParent' => $opsParent, 'webPage' => $webPage, 'webFolder' => $webFolder,
        'opsTemplate' => Template::factory()->create(['project_id' => $ops->id, 'name' => 'Geheime Vorlage', 'created_by' => $mara->id]),
        'webTemplate' => Template::factory()->create(['project_id' => $web->id, 'name' => 'Öffentliche Vorlage', 'created_by' => $mara->id]),
        'opsRelation' => WorkItemRelation::factory()->create(['source_id' => $opsItem->id, 'target_id' => $opsOther->id]),
        'opsView' => $opsView,
        'opsNote' => $notify($opsItem),
        'webNote' => $notify($webItem),
    ];
    app(SearchIndexer::class)->rebuild();

    return $world;
};

/** The client of an account with a token of all three abilities, connected as an agent connects (`server/discover`, `tools/list`). */
$client = function (TestCase $t, User $user): McpClient {
    $mcp = McpClient::for($t, apiToken($user, ['read', 'write', 'mcp']));
    $mcp->discover();
    expect(array_column($mcp->tools(), 'name'))->toContain('whoami', 'work-items', 'manage-work-items');

    return $mcp;
};

$ok = function (array $result): array {
    expect($result['isError'])->toBeFalse((string) json_encode($result));

    return $result['structuredContent'];
};

/** What stands in for a reference nobody has: a ULID by a fresh ULID, a key by NOPE-1, a project identifier by NOPE. */
$unknown = fn (string $reference): string => match (true) {
    Str::isUlid(strtolower($reference)) => LEAK_UNKNOWN_ULID,
    (bool) preg_match('/^[A-Z][A-Z0-9]*-\d+\z/', $reference) => 'NOPE-1',
    default => 'NOPE',
};

/**
 * Every call on something of OPS, its arguments built by a row (its references marked with `$hide`): the expected
 * status of Ida's refusal and who succeeds with the same arguments (Mara, unless the row names another). A row may
 * bring its own positive call (`'positive' => fn ($w) => [account, arguments]`) where the same arguments cannot work
 * for anybody (a WEB page moved under an OPS page).
 *
 * @return array<string, array{0: string, 1: Closure, 2?: int}>
 */
$refusals = fn (): array => [
    // read tools
    'work-items get by key' => ['work-items', fn ($w, $hide) => ['action' => 'get', 'item' => $hide($w['opsItem']->key), 'include' => ['relations']]],
    'work-items get by ULID' => ['work-items', fn ($w, $hide) => ['action' => 'get', 'item' => $hide(strtoupper($w['opsItem']->id))]],
    'work-items history' => ['work-items', fn ($w, $hide) => ['action' => 'history', 'item' => $hide($w['opsItem']->key)]],
    'work-items subscribers' => ['work-items', fn ($w, $hide) => ['action' => 'subscribers', 'item' => $hide($w['opsItem']->key)]],
    'work-items list by project' => ['work-items', fn ($w, $hide) => ['action' => 'list', 'filter' => ['project' => $hide('OPS')]]],
    'work-items list by parent' => ['work-items', fn ($w, $hide) => ['action' => 'list', 'filter' => ['parent' => $hide($w['opsItem']->key)]]],
    'relations' => ['relations', fn ($w, $hide) => ['item' => $hide($w['opsItem']->key)]],
    'comments list' => ['comments', fn ($w, $hide) => ['action' => 'list', 'item' => $hide($w['opsItem']->key)]],
    'comments get' => ['comments', fn ($w, $hide) => ['action' => 'get', 'comment' => $hide($w['opsComment']->id)]],
    'attachments' => ['attachments', fn ($w, $hide) => ['attachment' => $hide($w['opsImage']->id)]],
    'pages tree' => ['pages', fn ($w, $hide) => ['action' => 'tree', 'project' => $hide('OPS')]],
    'pages get' => ['pages', fn ($w, $hide) => ['action' => 'get', 'page' => $hide($w['opsPage']->id)]],
    'pages versions' => ['pages', fn ($w, $hide) => ['action' => 'versions', 'page' => $hide($w['opsPage']->id)]],
    'pages version' => ['pages', fn ($w, $hide) => ['action' => 'version', 'page' => $hide($w['opsPage']->id), 'page_version' => $hide($w['opsVersion']->id)]],
    'pages item' => ['pages', fn ($w, $hide) => ['action' => 'item', 'item' => $hide($w['opsItem']->key)]],
    'templates get' => ['templates', fn ($w, $hide) => ['action' => 'get', 'template' => $hide($w['opsTemplate']->id)]],
    'templates runs' => ['templates', fn ($w, $hide) => ['action' => 'runs', 'template' => $hide($w['opsTemplate']->id)]],
    'templates draft' => ['templates', fn ($w, $hide) => ['action' => 'draft', 'template' => $hide($w['opsTemplate']->id)]],
    'projects get' => ['projects', fn ($w, $hide) => ['action' => 'get', 'project' => $hide('OPS')]],
    'projects get by ULID' => ['projects', fn ($w, $hide) => ['action' => 'get', 'project' => $hide($w['ops']->id)]],
    'projects members' => ['projects', fn ($w, $hide) => ['action' => 'members', 'project' => $hide('OPS')]],
    'automations' => ['automations', fn ($w, $hide) => ['project' => $hide('OPS')]],
    'organization state-usage' => ['organization', fn ($w, $hide) => ['action' => 'state-usage', 'project' => $hide('OPS')]],
    'people mentionable' => ['people', fn ($w, $hide) => ['action' => 'mentionable', 'project' => $hide('OPS'), 'q' => 'o']],

    // write tools
    'get-upload-url' => ['get-upload-url', fn ($w, $hide) => ['input' => ['project_id' => $hide('OPS'), 'kind' => 'inline']]],
    'get-upload-url for the file list' => ['get-upload-url', fn ($w, $hide) => ['input' => ['project_id' => $hide('OPS'), 'kind' => 'file', 'work_item_id' => $hide($w['opsItem']->key)]]],
    // WEB is hers, the item of OPS is not: unknown like an item nobody has, never `field.work_item_id.project`
    'get-upload-url for the file list of WEB with an OPS item' => ['get-upload-url', fn ($w, $hide) => ['input' => ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $hide($w['opsItem']->key)]],
        'positive' => fn ($w) => ['ida', ['input' => ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => 'WEB-1']]]],
    'manage-work-items create' => ['manage-work-items', fn ($w, $hide) => ['action' => 'create', 'input' => ['project_id' => $hide('OPS'), 'title' => 'Eingeschmuggelt']]],
    'manage-work-items update' => ['manage-work-items', fn ($w, $hide) => ['action' => 'update', 'item' => $hide($w['opsItem']->key), 'input' => ['title' => 'Umbenannt']]],
    'manage-work-items transition' => ['manage-work-items', fn ($w, $hide) => ['action' => 'transition', 'item' => $hide($w['opsOther']->key), 'input' => [
        'to_state_id' => $w['ops']->workflow->states->firstWhere('id', '!=', $w['opsOther']->state_id)->id,
    ]]],
    'manage-work-items change-type' => ['manage-work-items', fn ($w, $hide) => ['action' => 'change-type', 'item' => $hide($w['opsOther']->key), 'input' => [
        'type_id' => WorkItemType::query()->where('name', 'Bug')->value('id'),
    ]]],
    'manage-work-items archive' => ['manage-work-items', fn ($w, $hide) => ['action' => 'archive', 'item' => $hide($w['opsClosed']->key)]],
    'manage-work-items restore' => ['manage-work-items', fn ($w, $hide) => ['action' => 'restore', 'item' => $hide($w['opsArchived']->key)]],
    'manage-work-items subscribe' => ['manage-work-items', fn ($w, $hide) => ['action' => 'subscribe', 'item' => $hide($w['opsItem']->key)]],
    'manage-work-items unsubscribe' => ['manage-work-items', fn ($w, $hide) => ['action' => 'unsubscribe', 'item' => $hide($w['opsItem']->key)]],
    'manage-work-items delete' => ['manage-work-items', fn ($w, $hide) => ['action' => 'delete', 'item' => $hide(WorkItem::factory()->for($w['ops'])->create()->key)]],
    'manage-relations add from OPS' => ['manage-relations', fn ($w, $hide) => ['action' => 'add', 'item' => $hide($w['opsItem']->key), 'input' => [
        'type_id' => RelationType::query()->where('built_in', 'blocks')->value('id'), 'target_id' => 'WEB-1',
    ]]],
    'manage-relations add to OPS' => ['manage-relations', fn ($w, $hide) => ['action' => 'add', 'item' => 'WEB-1', 'input' => [
        'type_id' => RelationType::query()->where('built_in', 'blocks')->value('id'), 'target_id' => $hide($w['opsOther']->key),
    ]], 422],
    'manage-relations remove' => ['manage-relations', fn ($w, $hide) => ['action' => 'remove', 'relation' => $hide($w['opsRelation']->id)]],
    'manage-comments add' => ['manage-comments', fn ($w, $hide) => ['action' => 'add', 'item' => $hide($w['opsItem']->key), 'input' => ['body' => 'Hallo?']]],
    'manage-comments edit' => ['manage-comments', fn ($w, $hide) => ['action' => 'edit', 'comment' => $hide($w['opsComment']->id), 'input' => ['body' => 'Geändert']]],
    'manage-comments react' => ['manage-comments', fn ($w, $hide) => ['action' => 'react', 'comment' => $hide($w['opsComment']->id), 'input' => ['emoji' => '👍']]],
    'manage-comments unreact' => ['manage-comments', fn ($w, $hide) => ['action' => 'unreact', 'comment' => $hide($w['opsComment']->id), 'input' => ['emoji' => '👍']]],
    'manage-comments delete' => ['manage-comments', fn ($w, $hide) => ['action' => 'delete', 'comment' => $hide(Comment::factory()->for($w['opsItem'], 'workItem')->create()->id)]],
    'manage-attachments' => ['manage-attachments', fn ($w, $hide) => ['attachment' => $hide(Attachment::factory()->forItem($w['opsItem'], 'file')->create(['uploaded_by' => $w['mara']->id])->id)]],
    'manage-pages create' => ['manage-pages', fn ($w, $hide) => ['action' => 'create', 'project' => $hide('OPS'), 'input' => ['title' => 'Eingeschmuggelt']]],
    'manage-pages update' => ['manage-pages', fn ($w, $hide) => ['action' => 'update', 'page' => $hide($w['opsPage']->id), 'input' => ['title' => 'Umbenannt']]],
    'manage-pages move' => ['manage-pages', fn ($w, $hide) => ['action' => 'move', 'page' => $hide($w['opsPage']->id), 'input' => ['parent_id' => null, 'before_id' => null]]],
    'manage-pages move under OPS' => ['manage-pages', fn ($w, $hide) => ['action' => 'move', 'page' => $w['webPage']->id, 'input' => ['parent_id' => $hide($w['opsParent']->id), 'before_id' => null]], 422,
        'positive' => fn ($w) => ['ida', ['action' => 'move', 'page' => $w['webPage']->id, 'input' => ['parent_id' => $w['webFolder']->id, 'before_id' => null]]]],
    'manage-pages restore-version' => ['manage-pages', fn ($w, $hide) => ['action' => 'restore-version', 'page' => $hide($w['opsPage']->id), 'page_version' => $hide($w['opsVersion']->id)]],
    'manage-pages delete' => ['manage-pages', fn ($w, $hide) => ['action' => 'delete', 'page' => $hide(Page::factory()->create(['project_id' => $w['ops']->id, 'created_by' => $w['mara']->id])->id)]],
    'manage-templates create' => ['manage-templates', fn ($w, $hide) => ['action' => 'create', 'project' => $hide('OPS'), 'input' => ['name' => 'Eingeschmuggelt', 'payload' => ['title' => 'X'], 'schedule' => null]]],
    'manage-templates update' => ['manage-templates', fn ($w, $hide) => ['action' => 'update', 'template' => $hide($w['opsTemplate']->id), 'input' => ['name' => 'Umbenannt', 'payload' => ['title' => 'X'], 'schedule' => null]]],
    'manage-templates run' => ['manage-templates', fn ($w, $hide) => ['action' => 'run', 'template' => $hide($w['opsTemplate']->id)]],
    'manage-templates delete' => ['manage-templates', fn ($w, $hide) => ['action' => 'delete', 'template' => $hide(Template::factory()->create(['project_id' => $w['ops']->id, 'created_by' => $w['mara']->id])->id)]],
    'manage-automations' => ['manage-automations', fn ($w, $hide) => ['project' => $hide('OPS'), 'key' => 'close_parent', 'input' => ['enabled' => true]]],
    'manage-projects update' => ['manage-projects', fn ($w, $hide) => ['action' => 'update', 'project' => $hide('OPS'), 'input' => ['name' => 'Umbenannt']]],
    'manage-projects set-workflow' => ['manage-projects', fn ($w, $hide) => ['action' => 'set-workflow', 'project' => $hide('OPS'), 'input' => ['workflow_id' => Workflow::default()->id, 'mapping' => []]]],
    'manage-projects redistribute-ranks' => ['manage-projects', fn ($w, $hide) => ['action' => 'redistribute-ranks', 'project' => $hide('OPS')]],
    'manage-projects join' => ['manage-projects', fn ($w, $hide) => ['action' => 'join', 'project' => $hide('OPS')], 'positive' => fn ($w) => ['admin', ['action' => 'join', 'project' => 'OPS']]],
    'manage-projects add-member' => ['manage-projects', fn ($w, $hide) => ['action' => 'add-member', 'project' => $hide('OPS'), 'input' => ['user_id' => $w['ida']->id, 'role' => 'viewer']],
        'positive' => fn ($w) => ['mara', ['action' => 'add-member', 'project' => 'OPS', 'input' => ['user_id' => User::factory()->create()->id, 'role' => 'viewer']]]],
    'manage-projects update-member' => ['manage-projects', fn ($w, $hide) => ['action' => 'update-member', 'project' => $hide('OPS'), 'user' => $w['olaf']->id, 'input' => ['role' => 'viewer']]],
    'manage-projects remove-member' => ['manage-projects', fn ($w, $hide) => ['action' => 'remove-member', 'project' => $hide('OPS'), 'user' => $w['paul']->id]],
    'manage-projects toggle-favorite' => ['manage-projects', fn ($w, $hide) => ['action' => 'toggle-favorite', 'input' => ['kind' => 'project', 'id' => $hide($w['ops']->id)]]],
    'manage-projects archive' => ['manage-projects', fn ($w, $hide) => ['action' => 'archive', 'project' => $hide(Project::factory()->private()->member($w['mara'], ProjectRole::Admin)->create()->identifier)]],
    'manage-projects restore' => ['manage-projects', fn ($w, $hide) => ['action' => 'restore', 'project' => $hide(Project::factory()->private()->archived()->member($w['mara'], ProjectRole::Admin)->create()->identifier)]],
    'manage-projects delete' => ['manage-projects', fn ($w, $hide) => ['action' => 'delete', 'project' => $hide(Project::factory()->private()->member($w['mara'], ProjectRole::Admin)->create()->identifier)]],
    'manage-notifications delete' => ['manage-notifications', fn ($w, $hide) => ['action' => 'delete', 'notification' => $hide($w['opsNote']->id)],
        'positive' => fn ($w) => ['ida', ['action' => 'delete', 'notification' => $w['webNote']->id]]],
];

/** The strings of `$value` (arguments) with every marked reference swapped for what nobody has. */
$swap = function (mixed $value, array $hidden) use ($unknown, &$swap): mixed {
    if (is_array($value)) {
        return array_map(fn (mixed $part) => $swap($part, $hidden), $value);
    }

    return is_string($value) && in_array($value, $hidden, true) ? $unknown($value) : $value;
};

it('answers an outsider on everything of a private project as on an unknown id', function () use ($world, $client, $refusals, $swap) {
    $w = $world();
    $clients = ['ida' => $client($this, $w['ida']), 'mara' => $client($this, $w['mara']), 'admin' => $client($this, $w['admin'])];
    $tools = [];

    foreach ($refusals() as $label => $row) {
        [$tool, $build] = $row;
        $status = $row[2] ?? 404;
        $hidden = [];
        $arguments = $build($w, function (string $reference) use (&$hidden): string {
            $hidden[] = $reference;

            return $reference;
        });
        $nobody = $swap($arguments, $hidden);
        expect(count($hidden))->toBeGreaterThan(0, "{$label}: marks no reference");

        $refused = $clients['ida']->call($tool, $arguments);
        $missing = $clients['ida']->call($tool, $nobody);
        expect($refused['isError'])->toBeTrue("{$label}: Ida got ".json_encode($refused))
            ->and($refused['structuredContent']['status'])->toBe($status, "{$label}: ".json_encode($refused))
            ->and($refused)->toBe($missing, "{$label}: the refusal differs from the answer on an unknown id");

        [$who, $positive] = isset($row['positive']) ? ($row['positive'])($w) : ['mara', $arguments];
        $done = $clients[$who]->call($tool, $positive);
        expect($done['isError'])->toBeFalse("{$label}: {$who} got ".json_encode($done));

        $tools[$tool] = true;
    }

    expect(array_keys($tools))->toEqualCanonicalizing([
        'work-items', 'relations', 'comments', 'attachments', 'pages', 'templates', 'projects', 'automations', 'organization', 'people',
        'get-upload-url', 'manage-work-items', 'manage-relations', 'manage-comments', 'manage-attachments', 'manage-pages', 'manage-templates',
        'manage-automations', 'manage-projects', 'manage-notifications',
    ]);
});

it('shows an outsider nothing of a private project in lists and the search', function () use ($world, $client, $ok) {
    $w = $world();
    $ida = $client($this, $w['ida']);
    $mara = $client($this, $w['mara']);
    $opsKeys = [$w['opsItem']->key, $w['opsOther']->key, $w['opsClosed']->key];

    // the search: a word both projects share, words only OPS has, the key of an OPS item (K13: no key match)
    $search = fn (McpClient $mcp, string $q) => $ok($mcp->call('search', ['q' => $q, 'types' => ['items', 'pages', 'projects'], 'include_archived' => 1]))['data'];
    $shared = $search($ida, 'Server');
    $secret = $search($ida, 'Geheim');
    $byKey = $search($ida, 'OPS-1');
    $byNobody = $search($ida, 'NOPE-1');
    expect(array_column($shared['items'], 'key'))->toBe(['WEB-1'])
        ->and(array_column($search($mara, 'Server')['items'], 'key'))->toEqualCanonicalizing(['WEB-1', 'OPS-1'])
        ->and([$secret['items'], $secret['pages'], $secret['projects']])->toBe([[], [], []])
        ->and(array_column($search($mara, 'Geheim')['items'], 'key'))->toContain('OPS-1')
        ->and(array_column($search($mara, 'Geheim')['pages'], 'title'))->toContain('Geheime Seite')
        ->and(array_column($search($mara, 'Geheim')['projects'], 'identifier'))->toBe(['OPS'])
        ->and($byKey)->toBe($byNobody)
        ->and($byKey['key_match'])->toBeNull()
        ->and($search($mara, 'OPS-1')['key_match'])->toBe($w['opsItem']->id);

    // the item lists: everything of WEB, nothing of OPS; a filter on OPS reads like one on a project nobody has
    $keys = fn (array $result) => array_column($result['data'], 'key');
    expect($keys($ok($ida->call('work-items', ['action' => 'list', 'per_page' => 100]))))->toBe(['WEB-1'])
        ->and($keys($ok($mara->call('work-items', ['action' => 'list', 'per_page' => 100]))))->toEqualCanonicalizing(['WEB-1', ...$opsKeys]);
    $onOps = ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => $w['ops']->id]]];
    $onNobody = ['version' => 1, 'conditions' => [['field' => 'project', 'op' => 'is', 'value' => LEAK_UNKNOWN_ULID]]];
    $queried = $ida->call('work-items', ['action' => 'query', 'input' => ['filter' => $onOps]]);
    expect($ok($queried)['meta']['total'])->toBe(0)
        ->and($queried)->toBe($ida->call('work-items', ['action' => 'query', 'input' => ['filter' => $onNobody]]))
        ->and($keys($ok($mara->call('work-items', ['action' => 'query', 'input' => ['filter' => $onOps]]))))->toEqualCanonicalizing($opsKeys);
    $groups = fn (McpClient $mcp) => array_column($ok($mcp->call('work-items', ['action' => 'groups', 'input' => ['group_by' => 'project', 'include_archived' => true]]))['data']['groups'], 'key');
    expect($groups($ida))->toBe([$w['web']->id])
        ->and($groups($mara))->toEqualCanonicalizing([$w['web']->id, $w['ops']->id]);
    $counts = fn (McpClient $mcp) => $ok($mcp->call('work-items', ['action' => 'counts', 'input' => ['filters' => ['ops' => $onOps, 'nobody' => $onNobody]]]))['data'];
    expect($counts($ida))->toBe(['ops' => 0, 'nobody' => 0])
        ->and($counts($mara))->toBe(['ops' => 3, 'nobody' => 0]);

    // a view on OPS, Mara's and one Ida writes herself with the ULID of OPS: empty for her, OPS for Mara
    $hers = $ok($ida->call('manage-views', ['action' => 'create', 'input' => [
        'name' => 'Neugier', 'icon' => 'layers', 'filter' => $onOps,
        'display' => ['layout' => 'list', 'group_by' => 'none', 'sort' => ['field' => 'key', 'direction' => 'asc'], 'fields' => ['key', 'title'], 'show_sub_items' => true],
    ]]))['data'];
    foreach ([$w['opsView']->id, $hers['id']] as $view) {
        $empty = $ok($ida->call('views', ['action' => 'items', 'view' => $view]));
        expect($empty['data'])->toBe([])
            ->and($empty['meta']['total'])->toBe(0)
            ->and($keys($ok($mara->call('views', ['action' => 'items', 'view' => $view]))))->toEqualCanonicalizing($opsKeys);
    }

    // projects, favorites, templates, the inbox: WEB only
    $projects = fn (McpClient $mcp) => array_column($ok($mcp->call('projects', ['action' => 'list', 'include_archived' => 1]))['data'], 'identifier');
    expect($projects($ida))->toBe(['WEB'])
        ->and($projects($mara))->toEqualCanonicalizing(['WEB', 'OPS']);
    expect(array_column($ok($ida->call('projects', ['action' => 'favorites']))['data'], 'id'))->toBe([$w['web']->id])
        ->and(Favorite::query()->where('user_id', $w['ida']->id)->pluck('favoritable_id')->all())->toContain($w['ops']->id);
    $templates = fn (McpClient $mcp, array $filter = []) => array_column($ok($mcp->call('templates', ['action' => 'list', 'filter' => $filter]))['data'], 'name');
    expect($templates($ida))->toBe(['Öffentliche Vorlage'])
        ->and($templates($ida, ['project_id' => $w['ops']->id]))->toBe([])
        ->and($ida->call('templates', ['action' => 'list', 'filter' => ['project_id' => $w['ops']->id]]))->toBe($ida->call('templates', ['action' => 'list', 'filter' => ['project_id' => LEAK_UNKNOWN_ULID]]))
        ->and($templates($mara, ['project_id' => $w['ops']->id]))->toBe(['Geheime Vorlage']);
    expect(array_column($ok($ida->call('notifications', ['action' => 'list']))['data'], 'id'))->toBe([$w['webNote']->id])
        ->and(Notification::query()->where('user_id', $w['ida']->id)->pluck('id')->all())->toContain($w['opsNote']->id);
    $read = fn (string $id) => $ok($ida->call('manage-notifications', ['action' => 'read', 'input' => ['ids' => [$id]]]));
    expect($read($w['opsNote']->id))->toBe(['updated' => 0])
        ->and($read(LEAK_UNKNOWN_ULID))->toBe(['updated' => 0])
        ->and($read($w['webNote']->id))->toBe(['updated' => 1]);
    $unread = fn (string $id) => $ok($ida->call('manage-notifications', ['action' => 'unread', 'input' => ['ids' => [$id]]]));
    Notification::query()->whereKey($w['opsNote']->id)->update(['read_at' => now()]);
    expect($unread($w['opsNote']->id))->toBe(['updated' => 0])
        ->and($unread(LEAK_UNKNOWN_ULID))->toBe(['updated' => 0])
        ->and($unread($w['webNote']->id))->toBe(['updated' => 1])
        ->and(Notification::query()->find($w['opsNote']->id)?->read_at)->not->toBeNull();

    // the bulk edit: a key of OPS is rejected as `not_found` like a key nobody has (the id echoes the reference)
    $bulk = fn (McpClient $mcp, string $key) => $ok($mcp->call('manage-work-items', ['action' => 'bulk-update', 'input' => ['ids' => [$key], 'patch' => ['priority' => 'high']]]));
    $onOpsKey = $bulk($ida, $w['opsItem']->key);
    $onNobodyKey = $bulk($ida, 'NOPE-1');
    expect($onOpsKey['updated'])->toBe([])
        ->and(array_column($onOpsKey['rejected'], 'reason'))->toBe(['not_found'])
        ->and(array_column($onOpsKey['rejected'], 'reason'))->toBe(array_column($onNobodyKey['rejected'], 'reason'))
        ->and($onNobodyKey['updated'])->toBe([])
        ->and($w['opsItem']->fresh()?->priority->value)->not->toBe('high')
        ->and($bulk($mara, $w['opsItem']->key))->toBe(['updated' => [$w['opsItem']->id], 'rejected' => []])
        ->and($w['opsItem']->fresh()?->priority->value)->toBe('high');

    // the use of a workflow counts only in the projects the reader sees
    $agency = Workflow::factory()->create(['name' => 'Nur Betrieb']);
    $w['ops']->update(['workflow_id' => $agency->id]);
    WorkItem::factory()->for($w['ops']->fresh())->create();
    $usage = $ok($mara->call('organization', ['action' => 'state-usage', 'workflow' => $agency->id]))['data'];
    expect($ok($ida->call('organization', ['action' => 'state-usage', 'workflow' => $agency->id]))['data'])->toBe([])
        ->and($usage)->toContain(['state_id' => $agency->initial_state_id, 'items' => 1])
        ->and(array_sum(array_column($usage, 'items')))->toBe(5);
});

it('shows the hidden end of a relation and a reference without key, title or id', function () use ($world, $client, $ok) {
    $w = $world();
    $ida = $client($this, $w['ida']);
    $mara = $client($this, $w['mara']);
    $opsId = $w['opsItem']->id;
    $leaks = fn (array $result, bool $withId = true): array => array_values(array_filter(
        ['OPS-1', 'Geheim', ...$withId ? [$opsId, strtoupper($opsId), $w['opsPage']->id] : []],
        fn (string $secret) => str_contains((string) json_encode($result, JSON_UNESCAPED_UNICODE), $secret),
    ));

    // relations: the entry is there, its other end is not
    $relations = $ok($ida->call('relations', ['item' => 'WEB-1']));
    expect($relations['data'])->toHaveCount(1)
        ->and($relations['data'][0])->toMatchArray(['hidden' => true, 'other' => null, 'direction' => 'outward'])
        ->and($relations['data'][0]['relation']['target_id'])->toBe('')
        ->and($leaks($relations))->toBe([])
        ->and($ok($mara->call('relations', ['item' => 'WEB-1']))['data'][0]['other']['key'])->toBe('OPS-1');

    // the item: its relations embedded, its description with hidden references (the ULID of a reference stays, A229)
    $item = $ok($ida->call('work-items', ['action' => 'get', 'item' => 'WEB-1', 'include' => ['relations']]))['data'];
    expect($item['description'])->toBe("Hängt an [hidden](item:{$opsId}) und [hidden](page:{$w['opsPage']->id}).")
        ->and($item['relations'][0]['hidden'])->toBeTrue()
        ->and($leaks($item, withId: false))->toBe([]);
    expect($ok($mara->call('work-items', ['action' => 'get', 'item' => 'WEB-1']))['data']['description'])
        ->toBe("Hängt an OPS-1 und [Geheime Seite](page:{$w['opsPage']->id}).");

    // the history: the relation as a label and `hidden`
    $history = fn (McpClient $mcp) => collect($ok($mcp->call('work-items', ['action' => 'history', 'item' => 'WEB-1']))['data'])->firstWhere('type', 'work_item.relation_added');
    $hidden = $history($ida);
    expect($hidden['changes']['relation']['new'])->toBe(['label' => $hidden['changes']['relation']['new']['label'], 'hidden' => true])
        ->and($leaks($hidden))->toBe([])
        ->and($history($mara)['changes']['relation']['new'])->toMatchArray(['item_id' => $opsId, 'key' => 'OPS-1']);

    // a page of WEB that names OPS-1 and the OPS page
    $page = $ok($ida->call('pages', ['action' => 'get', 'page' => $w['webPage']->id]))['data'];
    expect($page['content'])->toBe("Siehe [hidden](item:{$opsId}) und [hidden](page:{$w['opsPage']->id}).")
        ->and($leaks($page, withId: false))->toBe([])
        ->and($ok($mara->call('pages', ['action' => 'get', 'page' => $w['webPage']->id]))['data']['content'])
        ->toBe("Siehe OPS-1 und [Geheime Seite](page:{$w['opsPage']->id}).");
});

it('lists no page of a private project that names a public item, not even as a number', function () use ($world, $client, $ok) {
    $w = $world();
    // a page of OPS names WEB-1 (A456): Ida sees the item, not the page; another item of WEB is named by nothing
    CreatePage::run(actor($w['mara']), $w['ops'], ['title' => 'Geheime Notiz', 'content' => "Betrifft {$w['webItem']->key}."]);
    $unnamed = WorkItem::factory()->for($w['web'])->create(['created_by' => $w['mara']->id]);
    $ida = $client($this, $w['ida']);
    $mara = $client($this, $w['mara']);
    $pages = fn (McpClient $mcp, string $key) => $ok($mcp->call('pages', ['action' => 'item', 'item' => $key]));

    $hidden = $pages($ida, $w['webItem']->key);
    $nothing = $pages($ida, $unnamed->key);
    expect($hidden['data'])->toBe([])
        ->and($hidden['meta']['total'])->toBe(0)
        ->and(str_contains((string) json_encode($hidden, JSON_UNESCAPED_UNICODE), 'Geheim'))->toBeFalse('MCP names the page of OPS')
        ->and([$hidden['data'], $hidden['meta']['total'], $hidden['meta']['next_cursor']])->toBe([$nothing['data'], $nothing['meta']['total'], $nothing['meta']['next_cursor']])
        ->and(array_column($pages($mara, $w['webItem']->key)['data'], 'title'))->toBe(['Geheime Notiz']);

    // REST answers the same
    $rest = function (User $user, string $key) {
        // a new request: the guard of the test app would still know the account of the call before
        forgetApiAuth();

        return $this->withToken(apiToken($user, ['read']))->getJson("/api/v1/work-items/{$key}/pages")->assertOk();
    };
    $answer = $rest($w['ida'], $w['webItem']->key);
    expect($answer->json('data'))->toBe([])
        ->and($answer->json('meta.total'))->toBe(0)
        ->and(str_contains($answer->getContent() ?: '', 'Geheim'))->toBeFalse('REST names the page of OPS')
        ->and($rest($w['olaf'], $w['webItem']->key)->json('data.0.title'))->toBe('Geheime Notiz');
});

it('lets secrets and invitation links leave only where REST shows them', function () use ($world, $client, $ok) {
    $w = $world();
    $erik = $client($this, $w['admin']);
    $ida = $client($this, $w['ida']);
    $json = fn (array $result): string => (string) json_encode($result, JSON_UNESCAPED_SLASHES);

    // the secret of a webhook: in the results of create and rotate-secret, in no other result
    $created = $ok($erik->call('manage-webhooks', ['action' => 'create', 'input' => [
        'name' => 'Empfänger', 'url' => 'https://receiver.example.com/hook', 'project_id' => $w['ops']->id, 'events' => ['work_item.*'], 'bot_id' => null, 'active' => true,
    ]]));
    $id = $created['data']['id'];
    $secret = $created['secret'];
    $answers = [
        'get' => $erik->call('webhooks', ['action' => 'get', 'webhook' => $id]),
        'list' => $erik->call('webhooks', ['action' => 'list']),
        'ping' => $erik->call('manage-webhooks', ['action' => 'ping', 'webhook' => $id]),
        'deliveries' => $erik->call('webhooks', ['action' => 'deliveries', 'webhook' => $id]),
        'update' => $erik->call('manage-webhooks', ['action' => 'update', 'webhook' => $id, 'input' => [...$created['data'], 'name' => 'Umbenannt']]),
    ];
    $rotated = $ok($erik->call('manage-webhooks', ['action' => 'rotate-secret', 'webhook' => $id]));
    expect(str_starts_with($secret, 'whsec_'))->toBeTrue('create gave no secret')
        ->and(str_starts_with($rotated['secret'], 'whsec_') && $rotated['secret'] !== $secret)->toBeTrue('rotate-secret gave no new secret');
    foreach ($answers as $action => $answer) {
        expect($answer['isError'])->toBeFalse("{$action} failed")
            ->and(str_contains($json($answer), $secret))->toBeFalse("{$action} shows the secret");
    }

    // a member who is no org admin: the tool is listed for a writing token, every call refused before a webhook is read
    // (webhooks are no secret of a project but of the organization: 403, never 404, phase 11; an id nobody has binds to nothing first)
    $refused = $ida->call('webhooks', ['action' => 'get', 'webhook' => $id]);
    $listed = $ida->call('webhooks', ['action' => 'list']);
    expect($refused['structuredContent'])->toBe(['type' => 'urn:werkbuch:problem:forbidden', 'title' => 'Forbidden', 'status' => 403, 'detail' => __('problem.detail.webhooks_admins_only'), 'reason' => 'forbidden'])
        ->and($listed['structuredContent'])->toBe($refused['structuredContent'])
        ->and(array_column($ok($erik->call('webhooks', ['action' => 'list']))['data'], 'name'))->toBe(['Umbenannt']);

    // a workflow only OPS uses: the admin hears that OPS uses it, a member is refused before it is looked at (the
    // workflows themselves are no secret, every account reads them)
    $only = Workflow::factory()->create(['name' => 'Nur Betrieb']);
    $w['ops']->update(['workflow_id' => $only->id]);
    $inUse = $erik->call('manage-organization', ['action' => 'delete-workflow', 'id' => $only->id]);
    $member = $ida->call('manage-organization', ['action' => 'delete-workflow', 'id' => $only->id]);
    expect($inUse['structuredContent'])->toMatchArray(['status' => 409, 'reason' => 'in_use'])
        ->and($inUse['structuredContent']['projects'])->toBe(['OPS'])
        ->and(str_contains($json($member), 'OPS'))->toBeFalse('the refusal of a member names OPS')
        ->and($member['structuredContent'])->toBe(['type' => 'urn:werkbuch:problem:forbidden', 'title' => 'Forbidden', 'status' => 403, 'detail' => __('problem.detail.workflows_admins_only'), 'reason' => 'forbidden'])
        ->and($ok($ida->call('organization', ['action' => 'get-workflow', 'id' => $only->id]))['data']['name'])->toBe('Nur Betrieb');

    // the tokens of another person: refused without a word of them, and her own she lists
    $w['mara']->createToken('Maras Agent', ['read']);
    $foreign = $ida->call('people', ['action' => 'list-tokens', 'filter' => ['user_id' => $w['mara']->id]]);
    expect($foreign['structuredContent'])->toMatchArray(['status' => 403, 'reason' => 'forbidden'])
        ->and($json($foreign))->not->toContain('Maras Agent')
        ->and(array_column($ok($client($this, $w['mara'])->call('people', ['action' => 'list-tokens']))['data'], 'name'))->toContain('Maras Agent');

    // a token: its id in the list, its secret nowhere (neither in the list nor in whoami)
    $plain = apiToken($w['ida'], ['read', 'mcp']);
    [$tokenId, $tokenSecret] = explode('|', $plain, 2);
    $tokens = $ida->call('people', ['action' => 'list-tokens', 'per_page' => 100]);
    expect(array_column($ok($tokens)['data'], 'id'))->toContain($tokenId)
        ->and(str_contains($json($tokens), $tokenSecret))->toBeFalse('list-tokens shows the secret of a token')
        ->and(str_contains($json($ida->call('whoami')), $tokenSecret))->toBeFalse('whoami shows the secret of a token');

    // an invitation: the link for a token that may write, null for one that may only read
    $invited = $ok($erik->call('manage-people', ['action' => 'invite', 'input' => ['email' => 'neu@example.com', 'org_role' => 'member']]));
    $link = $invited['link'];
    $reader = McpClient::for($this, apiToken($w['admin'], ['read', 'mcp']));
    $reader->discover();
    $readerTools = array_column($reader->tools(), 'name');
    $inviteOf = fn (McpClient $mcp) => collect($ok($mcp->call('people', ['action' => 'list-invitations']))['data'])->firstWhere('email', 'neu@example.com');
    expect($link)->toStartWith(config('app.url').'/invitations/')
        ->and($inviteOf($erik)['link'])->toBe($link)
        ->and($inviteOf($reader)['link'])->toBeNull()
        ->and(str_contains($json($reader->call('people', ['action' => 'list-invitations'])), $link))->toBeFalse('a read token reads the link')
        ->and($readerTools)->toContain('people')
        ->and(array_values(array_filter($readerTools, fn (string $tool) => str_starts_with($tool, 'manage-') || $tool === 'get-upload-url')))->toBe([])
        ->and(array_column($erik->tools(), 'name'))->toContain('manage-people');
});

it('probes every tool of the server', function () use ($world) {
    // the tools the tests of this file call: the refusals (computed there) and the four tests above
    $probed = [
        'work-items', 'relations', 'comments', 'attachments', 'pages', 'templates', 'projects', 'automations', 'organization', 'people',
        'get-upload-url', 'manage-work-items', 'manage-relations', 'manage-comments', 'manage-attachments', 'manage-pages', 'manage-templates',
        'manage-automations', 'manage-projects', 'manage-notifications',
        'search', 'manage-views', 'views', 'notifications', 'webhooks', 'manage-webhooks', 'manage-organization', 'whoami', 'manage-people',
    ];
    $w = $world();
    $mcp = McpClient::for($this, apiToken($w['admin'], ['read', 'write', 'mcp']));
    $mcp->discover();

    expect($probed)->toEqualCanonicalizing(array_column($mcp->tools(), 'name'));
});
