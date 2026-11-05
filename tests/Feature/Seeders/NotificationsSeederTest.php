<?php

use App\Domain\Notifications\NotificationKind;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkflowState;
use Carbon\CarbonInterface;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\NotificationsSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

beforeEach(fn () => Storage::fake('local'));

/**
 * Mara's notifications of the clickdummy (src/api/seed/inbox.ts, the `rows`), parsed from the file: a row copied
 * wrong, a missed one or a changed seed shows here. A comment `c_<item>_<n>` is the n-th comment of its item by time,
 * as the CommentsSeeder writes them.
 *
 * @return array<string, array{kind: string, key: string|null, project: string|null, actor: string|null, created: string, read: string|null, comment: array{0: string, 1: int}|null, states: array{0: string, 1: string}|null, fields: list<string>|null, due: string|null}>
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/inbox.ts'));
    $start = (int) strpos($source, 'const rows');
    $block = substr($source, $start, (int) strpos($source, 'export const notifications') - $start);
    $chunks = preg_split("/(?=\{\s*id: 'n_)/", $block) ?: [];
    $field = fn (string $chunk, string $name): ?string => preg_match("/\b{$name}: '([^']*)'/", $chunk, $match) === 1 ? $match[1] : null;

    $rows = [];
    foreach (array_slice($chunks, 1) as $chunk) {
        $comment = $field($chunk, 'comment_id');
        preg_match("/^c_([a-z]+)(\d+)_(\d+)$/", (string) $comment, $ref);
        $from = $field($chunk, 'from_state_id');
        preg_match("/fields: \[([^\]]*)\]/", $chunk, $fields);
        $project = $field($chunk, 'project');
        $item = $field($chunk, 'item');

        $rows['seed:'.$field($chunk, 'id')] = [
            'kind' => (string) $field($chunk, 'event'),
            'key' => $item,
            'project' => $item !== null ? explode('-', $item)[0] : ($project === null ? null : strtoupper(substr($project, 2))),
            'actor' => $field($chunk, 'actor'),
            'created' => (string) $field($chunk, 'created'),
            'read' => $field($chunk, 'read'),
            'comment' => $comment === null ? null : [strtoupper($ref[1]).'-'.$ref[2], (int) $ref[3]],
            'states' => $from === null ? null : [substr($from, 4), substr((string) $field($chunk, 'to_state_id'), 4)],
            'fields' => $fields === [] ? null : array_map(fn (string $name) => trim($name, " '"), explode(',', $fields[1])),
            'due' => $field($chunk, 'due_date'),
        ];
    }

    return $rows;
};

/**
 * The comments of the clickdummy's activity.ts by their ID: item, author and time as the file writes them (T12-M2: the
 * comment a notification names is checked against the seed, not against the rule that picked it).
 *
 * @return array<string, array{key: string, author: string, when: string}>
 */
$seedComments = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/activity.ts'));
    preg_match_all("/comment\('(c_\w+)', '([A-Z]+-\d+)', '(\w+)', '([\d :-]+)'/", $source, $rows, PREG_SET_ORDER);

    return collect($rows)->mapWithKeys(fn (array $row) => [$row[1] => ['key' => $row[2], 'author' => $row[3], 'when' => $row[4]]])->all();
};

/** The n-th comment of an item by time. */
$commentOf = fn (string $key, int $n): ?string => Comment::query()->where('work_item_id', ItemsSeeder::find($key)?->id)
    ->orderBy('created_at')->orderBy('id')->skip($n - 1)->value('id');

it("seeds Mara's inbox like the clickdummy", function () use ($clickdummy, $commentOf, $seedComments) {
    $comments = $seedComments();
    $this->seed(DemoSeeder::class);
    $expected = $clickdummy();
    $mara = User::query()->where('handle', 'mara')->sole();
    $stored = Notification::query()->with(['workItem.project', 'project', 'actor'])->orderBy('dedupe_key')->get()->keyBy('dedupe_key');
    $berlin = fn (?CarbonInterface $at) => $at?->clone()->setTimezone('Europe/Berlin')->format('m-d H:i');

    expect($expected)->toHaveCount(14)
        ->and($stored->keys()->sort()->values()->all())->toBe(collect($expected)->keys()->sort()->values()->all())
        ->and($stored->filter(fn (Notification $n) => $n->read_at === null)->keys()->sort()->values()->all())->toBe(['seed:n_01', 'seed:n_03', 'seed:n_04'])
        ->and($stored->every(fn (Notification $n) => $n->user_id === $mara->id && $n->inbox && $n->mail_id === null && $n->event_id === null))->toBeTrue();

    foreach ($expected as $dedupe => $row) {
        $notification = $stored[$dedupe];

        expect([
            'kind' => $notification->kind->value,
            'key' => $notification->workItem?->key,
            'project' => $notification->project?->identifier,
            'actor' => $notification->actor?->handle,
            'created' => $berlin($notification->created_at),
            'read' => $berlin($notification->read_at),
        ])->toBe([
            'kind' => $row['kind'],
            'key' => $row['key'],
            'project' => $row['project'],
            'actor' => $row['actor'],
            'created' => $row['created'],
            'read' => $row['read'],
        ], $dedupe);

        if ($row['comment'] !== null) {
            expect($notification->data['comment_id'])->toBe($commentOf(...$row['comment']))->not->toBeNull();
            // the comment of the seed: its item, its author, its time (Berlin wall clock)
            $seed = $comments['c_'.strtolower(str_replace('-', '', $row['comment'][0])).'_'.$row['comment'][1]];
            $comment = Comment::query()->with(['author', 'workItem.project'])->findOrFail($notification->data['comment_id']);
            expect([$comment->workItem->key, $comment->author->handle, $comment->created_at->setTimezone('Europe/Berlin')->format('m-d H:i')])
                ->toBe([$seed['key'], $seed['author'], substr($seed['when'], -11)]);
        }
        if ($row['states'] !== null) {
            expect([$notification->data['from']['name'], $notification->data['to']['name']])
                ->toBe([ItemsSeeder::STATES[$row['states'][0]], ItemsSeeder::STATES[$row['states'][1]]]);
        }
        if ($row['fields'] !== null) {
            expect($notification->data['fields'])->toBe($row['fields']);
        }
        if ($row['due'] !== null) {
            expect($notification->data)->toBe(['due_date' => $row['due'], 'overdue' => false]);
        }
    }

    // the mentions say where they are; the one of WEB-47 is in its description
    expect($stored['seed:n_01']->data['source'])->toBe('comment')
        ->and($stored['seed:n_13']->data)->toBe(['source' => 'description'])
        // the state changes keep the states as the events of the moves do (`meta.states`)
        ->and($stored['seed:n_05']->data['from'])->toHaveKeys(['id', 'name', 'category'])
        ->and($stored['seed:n_05']->data['to']['category'])->toBe('completed')
        // the organization notification has no project (K5), the template one its project, its template and the error
        ->and($stored['seed:n_10']->kind)->toBe(NotificationKind::WebhookDisabled)
        ->and($stored['seed:n_14']->data)->toBe(['template_id' => Template::query()->where('name', 'Zertifikate prüfen')->value('id'), 'error' => 'Pflicht-Property Umgebung fehlt'])
        // n_14 is five seconds after the hour, like the clickdummy's
        ->and($stored['seed:n_14']->created_at?->second)->toBe(5);
});

it('shows the inbox to Mara through the API', function () {
    $this->seed(DemoSeeder::class);
    $mara = User::query()->where('handle', 'mara')->sole();

    $this->actingAs($mara)->getJson('/api/v1/notifications?per_page=100')->assertOk()
        ->assertJsonCount(14, 'data')
        ->assertJsonPath('data.0.event', 'mentioned')
        ->assertJsonPath('data.0.excerpt', 'Hero-Entwurf ist drin, die Teaser kommen heute Nachmittag. @Mara Lindqvist kannst du die Texte kurz gegenlesen?');
});

it('writes no events and no mail collections', function () {
    $this->seed(DemoSeeder::class);
    // the seeder once more on an empty inbox: every event there was before, none more (T12-M1)
    Notification::query()->delete();
    $events = Event::query()->count();

    $this->seed(NotificationsSeeder::class);

    expect(Notification::query()->count())->toBe(14)
        ->and(Event::query()->count())->toBe($events)
        ->and(NotificationMail::query()->exists())->toBeFalse();
});

it('adds nothing on a second run', function () {
    $this->seed(DemoSeeder::class);
    $snapshot = fn () => DB::table('notifications')->orderBy('id')->get()->all();
    $before = $snapshot();
    $this->travel(5)->minutes();

    $this->seed(DemoSeeder::class);

    expect($snapshot())->toEqual($before)->and($before)->toHaveCount(14);
});

it('adds the notifications that are missing and leaves the others as they are', function () {
    $this->seed(DemoSeeder::class);
    Notification::query()->where('dedupe_key', 'seed:n_02')->delete();
    $read = Notification::query()->where('dedupe_key', 'seed:n_01')->sole();
    $read->update(['read_at' => now()]);

    $this->seed(NotificationsSeeder::class);

    expect(Notification::query()->count())->toBe(14)
        ->and($read->fresh()?->read_at?->equalTo($read->read_at))->toBeTrue();
});

it('leaves out a notification whose item is gone', function () {
    $this->seed(DemoSeeder::class);
    Notification::query()->delete();
    ItemsSeeder::find('APP-24')?->delete();

    $this->seed(NotificationsSeeder::class);

    expect(Notification::query()->count())->toBe(13)
        ->and(Notification::query()->where('dedupe_key', 'seed:n_04')->exists())->toBeFalse();
});

it('leaves out a notification whose comment is gone', function () {
    $this->seed(DemoSeeder::class);
    Notification::query()->delete();
    Comment::query()->where('work_item_id', ItemsSeeder::find('APP-15')?->id)->delete();

    $this->seed(NotificationsSeeder::class);

    expect(Notification::query()->where('dedupe_key', 'seed:n_03')->exists())->toBeFalse()
        ->and(Notification::query()->count())->toBe(13);
});

it('leaves out a state change whose states the workflow of the project no longer has', function () {
    $this->seed(DemoSeeder::class);
    Notification::query()->delete();
    // OPS-11 (In Progress → Done) and WEB-47 (Todo → In Progress), both on the shipped workflow: without a state of
    // that name the snapshot cannot be taken; WEB-40 (Todo → Done) still can
    $ops = Project::query()->where('identifier', 'OPS')->sole();
    WorkflowState::query()->where('workflow_id', $ops->workflow_id)->where('name', 'In Progress')->update(['name' => 'Doing']);

    $this->seed(NotificationsSeeder::class);

    expect(Notification::query()->where('kind', NotificationKind::StateChanged)->pluck('dedupe_key')->all())->toBe(['seed:n_11'])
        ->and(Notification::query()->count())->toBe(12);
});
