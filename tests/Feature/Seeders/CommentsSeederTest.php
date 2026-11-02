<?php

use App\Models\Comment;
use App\Models\CommentReaction;
use App\Models\Event;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemSubscriber;
use Database\Seeders\Demo\CommentsSeeder;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

beforeEach(fn () => Storage::fake('local'));

/**
 * The comments of the clickdummy (src/api/seed/activity.ts, the `comment(…)` rows), parsed from the file: a comment
 * copied wrong, a missed one or a changed seed shows here. The text of a comment whose body the file writes as blocks
 * (`p(…)`, `code(…)`) is its blocks, one a line.
 *
 * @return list<array{key: string, author: string, when: string, text: string, reactions: list<array{0: string, 1: list<string>}>}>
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/activity.ts'));
    $block = substr($source, (int) strpos($source, 'export const comments'), (int) strpos($source, 'export const events') - (int) strpos($source, 'export const comments'));
    $quoted = "'((?:[^'\\\\]|\\\\.)*)'";
    preg_match_all("/comment\('c_\w+', '([A-Z]+-\d+)', '(\w+)', '([\d :-]+)', {$quoted}(?:, \[(.*?)\])?\)(,\s*body: doc\((.*?)\),\s*\})?/s", $block, $rows, PREG_SET_ORDER);

    return array_map(function (array $row): array {
        $text = stripcslashes($row[4]);
        if (($row[7] ?? '') !== '') {
            preg_match_all("/(?:p\('((?:[^'\\\\]|\\\\.)*)'\)|code\(\"((?:[^\"\\\\]|\\\\.)*)\"\))/", $row[7], $blocks, PREG_SET_ORDER);
            $text = implode("\n", array_map(fn (array $part) => stripcslashes($part[1] !== '' ? $part[1] : $part[2]), $blocks));
        }
        preg_match_all("/\{ emoji: '([^']+)', users: \[([^\]]*)\] \}/u", $row[5] ?? '', $reactions, PREG_SET_ORDER);

        return [
            'key' => $row[1],
            'author' => $row[2],
            'when' => $row[3],
            'text' => $text,
            'reactions' => array_map(fn (array $reaction) => [$reaction[1], array_map(fn (string $user) => trim($user, " '"), explode(',', $reaction[2]))], $reactions),
        ];
    }, $rows);
};

/**
 * The text of a stored body as the clickdummy writes it: a line a block, a mention as `@` and its handle, a reference
 * as the key of its item (the key the stored node names, so a wrong node shows).
 */
$text = function (array $body): string {
    $inline = fn (array $node): string => match ($node['type']) {
        'text' => $node['text'],
        'mention' => '@'.User::query()->findOrFail($node['attrs']['id'])->handle,
        'reference' => WorkItem::query()->with('project')->findOrFail($node['attrs']['id'])->key,
        default => throw new RuntimeException("Unexpected node {$node['type']}."),
    };

    return implode("\n", array_map(fn (array $block) => implode('', array_map($inline, $block['content'] ?? [])), $body['content']));
};

/** The handles of the people who watch an item, with their reason. */
$watchers = fn (string $key): array => WorkItemSubscriber::query()->where('work_item_id', ItemsSeeder::find($key)?->id)->with('user')->get()
    ->mapWithKeys(fn (WorkItemSubscriber $row) => [$row->user->handle => $row->reason])->all();

it('seeds every comment of the clickdummy with its author, time, text and reactions', function () use ($clickdummy, $text) {
    $this->seed(DemoSeeder::class);
    $expected = $clickdummy();
    $stored = Comment::query()->with(['workItem.project', 'author', 'reactions'])->orderBy('created_at')->orderBy('id')->get();
    usort($expected, fn (array $a, array $b) => ItemsSeeder::at($a['when']) <=> ItemsSeeder::at($b['when']));
    $handles = User::query()->pluck('handle', 'id');

    expect($expected)->toHaveCount(17)
        ->and($stored->map(fn (Comment $comment) => [
            'key' => $comment->workItem->key,
            'author' => $comment->author->handle,
            'when' => $comment->created_at?->clone()->setTimezone('Europe/Berlin')->format('m-d H:i'),
            'text' => $text($comment->body),
            'reactions' => $comment->reactions->groupBy('emoji')->map(fn ($rows, string $emoji) => [$emoji, $rows->map(fn (CommentReaction $reaction) => $handles[$reaction->user_id])->all()])->values()->all(),
        ])->all())->toBe($expected)
        ->and($stored->every(fn (Comment $comment) => $comment->edited_at === null && $comment->body_text !== ''))->toBeTrue();
});

it('writes the code block of WEB-47 as a code block and keeps the plain text of every comment for the search', function () {
    $this->seed(DemoSeeder::class);
    $code = Comment::query()->where('work_item_id', ItemsSeeder::find('WEB-47')?->id)->whereHas('author', fn ($query) => $query->where('handle', 'jonas'))->sole();

    expect(array_column($code->body['content'], 'type'))->toBe(['paragraph', 'codeBlock'])
        ->and($code->body['content'][1]['attrs']['language'])->toBeNull()
        ->and($code->body_text)->toContain("plugin.on('submit'");
});

it('turns @mara and WEB-42 in the demo texts into nodes', function () {
    $this->seed(DemoSeeder::class);
    $mara = User::query()->where('handle', 'mara')->sole();
    $web47 = ItemsSeeder::find('WEB-47');
    $nodes = fn (array $doc) => array_values(array_filter($doc['content'][0]['content'], fn (array $node) => $node['type'] !== 'text'));
    $comment = fn (string $key) => Comment::query()->where('work_item_id', ItemsSeeder::find($key)?->id)->where('body_text', 'like', '%@mara%')->sole();

    expect($nodes($web47?->description ?? []))->toBe([
        ['type' => 'mention', 'attrs' => ['id' => $mara->id, 'label' => 'mara', 'mentionSuggestionChar' => '@']],
        ['type' => 'reference', 'attrs' => ['id' => ItemsSeeder::find('WEB-42')?->id, 'label' => null, 'mentionSuggestionChar' => '#', 'kind' => 'item']],
    ])
        ->and($web47?->description_version)->toBe(1)
        ->and($nodes(ItemsSeeder::find('APP-10')?->description ?? [])[0]['attrs']['id'])->toBe(ItemsSeeder::find('APP-9')?->id)
        ->and($nodes($comment('WEB-42')->body)[0]['attrs']['id'])->toBe($mara->id)
        ->and(array_map(fn (array $node) => $node['type'], $nodes($comment('OPS-3')->body)))->toBe(['reference', 'mention']);
});

it('subscribes commenters and mentioned people, never bots', function () use ($watchers) {
    $this->seed(DemoSeeder::class);

    // WEB-42: Ida created it, Lene commented, Ida's comment mentions Mara
    expect($watchers('WEB-42'))->toEqual(['ida' => 'created', 'lene' => 'commented', 'mara' => 'mentioned'])
        // WEB-47: Mara is mentioned in the description before she comments; Jonas watched as the assignee already
        ->and($watchers('WEB-47'))->toEqual(['ida' => 'created', 'jonas' => 'assigned', 'mara' => 'mentioned'])
        // OPS-12: Kira, a bot, commented and does not watch
        ->and($watchers('OPS-12'))->toEqual(['mara' => 'created', 'jonas' => 'assigned'])
        ->and($watchers('OPS-3'))->toEqual(['jonas' => 'created', 'mara' => 'mentioned'])
        ->and(WorkItemSubscriber::query()->whereIn('user_id', User::query()->where('type', 'bot')->select('id'))->exists())->toBeFalse();
});

it('records no events for the comments and the reactions (A86)', function () {
    $this->seed(DemoSeeder::class);

    expect(Event::query()->where('type', 'like', 'comment.%')->exists())->toBeFalse();
});

it('adds nothing on a second run', function () {
    $this->seed(DemoSeeder::class);
    $snapshot = fn () => [
        DB::table('comments')->orderBy('id')->get()->all(),
        DB::table('comment_reactions')->orderBy('id')->get()->all(),
        DB::table('work_item_subscribers')->orderBy('id')->get()->all(),
        Event::count(),
    ];
    $before = $snapshot();
    $this->travel(5)->minutes();

    $this->seed(DemoSeeder::class);

    expect($snapshot())->toEqual($before);
});

it('leaves the comments of an item that has comments of its own, and keeps a person who unsubscribed', function () {
    $this->seed(DemoSeeder::class);
    $web45 = ItemsSeeder::find('WEB-45');
    Comment::query()->where('work_item_id', $web45?->id)->oldest()->first()?->delete();
    $row = WorkItemSubscriber::query()->where('work_item_id', $web45?->id)->whereHas('user', fn ($query) => $query->where('handle', 'mara'))->sole();
    $row->update(['unsubscribed_at' => now()]);

    $this->seed(CommentsSeeder::class);

    expect(Comment::query()->where('work_item_id', $web45?->id)->count())->toBe(1)
        ->and($row->fresh()?->unsubscribed_at)->not->toBeNull();
});
