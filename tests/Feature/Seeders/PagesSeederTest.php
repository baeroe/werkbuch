<?php

use App\Models\Event;
use App\Models\Page;
use App\Models\PageVersion;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use Carbon\CarbonInterface;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\PagesSeeder;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// the demo files of the AttachmentsSeeder land on the disk `local`
beforeEach(fn () => Storage::fake('local'));

/**
 * The wiki of the clickdummy (src/api/seed/pages.ts), parsed from the file: a page copied wrong, a missed one or a
 * changed seed shows here. Rows by id: project, parent, rank, emoji, title, creator, times and version as the file
 * writes them; versions: the page each kept version belongs to and its number.
 *
 * @return array{rows: array<string, array<string, ?string>>, versions: list<array{0: string, 1: int}>}
 */
$clickdummy = function (): array {
    $source = (string) file_get_contents(repo_path('prototypes/clickdummy/src/api/seed/pages.ts'));
    $start = (int) strpos($source, 'const rows: PageRow[] = [');
    $block = substr($source, $start, (int) strpos($source, "\n];\n", $start) - $start);
    $rows = [];

    foreach (array_slice(preg_split("/(?=\bid: 'pg_\w+')/", $block) ?: [], 1) as $chunk) {
        $field = function (string $name) use ($chunk): ?string {
            preg_match("/\b{$name}: '((?:[^'\\\\]|\\\\.)*)'/u", $chunk, $match);

            return isset($match[1]) ? stripcslashes($match[1]) : null;
        };
        preg_match('/\bversion: (\d+)/', $chunk, $version);
        $rows[(string) $field('id')] = [
            'project' => $field('project'),
            'parent' => $field('parent'),
            'rank' => $field('rank'),
            'emoji' => $field('emoji'),
            'title' => $field('title'),
            'by' => $field('by'),
            'created' => $field('created'),
            'updated' => $field('updated') ?? $field('created'),
            'updatedBy' => $field('updatedBy') ?? $field('by'),
            'version' => $version[1] ?? '1',
            // the keys the text names, in order (`WEB-47`)
            'keys' => preg_match_all('/\\b[A-Z][A-Z0-9]{1,9}-\\d+\\b/', (string) strstr($chunk, 'content:'), $keys) ? implode(' ', $keys[0]) : '',
        ];
    }

    $versions = substr($source, (int) strpos($source, 'export const pageVersions'));
    preg_match_all("/page_id: '(pg_\w+)',\s*version: (\d+)/", $versions, $kept, PREG_SET_ORDER);

    return ['rows' => $rows, 'versions' => array_map(fn (array $match) => [$match[1], (int) $match[2]], $kept)];
};

/**
 * The text of a stored page as the clickdummy writes it: a line a block, a reference as the key of its item (the key the
 * stored node names, so a wrong node shows), like CommentsSeederTest reads a comment.
 */
$asWritten = function (array $content) use (&$asWritten): string {
    $inline = fn (array $node): string => match ($node['type']) {
        'text' => $node['text'],
        'reference' => WorkItem::query()->with('project')->findOrFail($node['attrs']['id'])->key,
        default => $asWritten($node),
    };

    return implode(isset($content['content'][0]['text']) || ($content['content'][0]['type'] ?? '') === 'reference' ? '' : "\n", array_map($inline, $content['content'] ?? []));
};

/** Everything a rerun must leave as it is. */
$snapshot = fn (): array => [
    Event::count(),
    DB::table('page_item_references')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all(),
    DB::table('pages')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all(),
    DB::table('page_versions')->orderBy('id')->get()->map(fn (object $row) => (array) $row)->all(),
];

it('seeds every page of the clickdummy with its parent, rank, emoji, creator, times and versions', function () use ($clickdummy) {
    $this->seed(DemoSeeder::class);
    ['rows' => $rows, 'versions' => $versions] = $clickdummy();
    $projects = ['p_web' => 'WEB', 'p_app' => 'APP', 'p_ops' => 'OPS'];
    $handles = User::query()->pluck('handle', 'id');
    $berlin = fn (?CarbonInterface $at) => $at?->clone()->setTimezone('Europe/Berlin')->format('m-d H:i');
    $stored = Page::query()->with(['project', 'parent'])->withCount('versions')->get()
        ->keyBy(fn (Page $page) => $page->project->identifier.'|'.$page->title);

    expect($rows)->toHaveCount(19)
        ->and(collect($rows)->countBy('project')->all())->toBe(['p_web' => 12, 'p_app' => 4, 'p_ops' => 3])
        ->and($stored)->toHaveCount(19);

    foreach ($rows as $row) {
        $page = $stored[$projects[$row['project']].'|'.$row['title']] ?? throw new RuntimeException("No page {$row['title']}.");
        $kept = count(array_filter($versions, fn (array $version) => $rows[$version[0]]['title'] === $row['title']));

        expect([
            'parent' => $page->parent?->title,
            'rank' => $page->rank,
            'emoji' => $page->emoji,
            'by' => $handles[$page->created_by],
            'created' => $berlin($page->created_at),
            'updated' => $berlin($page->updated_at),
            'updatedBy' => $handles[$page->updated_by],
            'version' => (string) $page->version,
            'versions' => $page->versions_count,
        ])->toBe([
            'parent' => $row['parent'] === null ? null : $rows[$row['parent']]['title'],
            'rank' => $row['rank'],
            'emoji' => $row['emoji'],
            'by' => $row['by'],
            'created' => $row['created'],
            'updated' => $row['updated'],
            'updatedBy' => $row['updatedBy'],
            'version' => $row['version'],
            'versions' => $kept,
        ]);
    }

    // the three versions of "Seitenstruktur", the one numbered like the page is its state now (T4-M1)
    $structure = $stored['WEB|Seitenstruktur'];
    expect($structure->versions->pluck('version')->all())->toBe([3, 2, 1])
        ->and($structure->versions->map(fn (PageVersion $version) => [$handles[$version->author_id], $berlin($version->created_at)])->all())
        ->toBe([['ida', '10-14 11:00'], ['ida', '10-06 16:20'], ['ida', '10-02 14:00']])
        ->and($structure->versions[0]->title)->toBe($structure->title)
        ->and($structure->versions[0]->content)->toBe($structure->content)
        ->and($structure->versions[1]->content)->not->toBe($structure->content)
        ->and(collect($versions)->pluck(1)->sort()->values()->all())->toBe([1, 2, 3]);
});

it('writes the text as stored rich text with its plain text and no event', function () {
    $this->seed(DemoSeeder::class);
    $form = Page::query()->where('title', 'Kontaktformular – Technik')->sole();
    $api = Page::query()->where('title', 'API-Schnittstelle')->sole();

    expect(array_column($form->content['content'], 'type'))->toBe(['paragraph', 'heading', 'orderedList', 'heading', 'paragraph'])
        ->and($form->content['content'][2]['attrs'])->toBe(['start' => 1, 'type' => null])
        // a reference has no plain text (Document::toText), the sentence around it stays
        ->and($form->content_text)->toContain('siehe . Bis zur Lösung')
        ->and(array_column($api->content['content'], 'type'))->toBe(['paragraph', 'codeBlock', 'paragraph'])
        ->and($api->content['content'][1]['content'][0]['text'])->toBe('GET /v2/orders?status=open')
        ->and(Event::query()->where('type', 'like', 'page.%')->count())->toBe(0)
        ->and(Page::query()->whereNull('content')->orWhereNull('content_text')->count())->toBe(0);
});

it('references the items the demo pages name', function () use ($clickdummy, $asWritten) {
    $this->seed(DemoSeeder::class);
    ['rows' => $rows] = $clickdummy();
    $keys = fn (array $content): array => array_map(
        fn (string $id) => WorkItem::query()->with('project')->findOrFail($id)->key,
        Document::fromJson($content)->itemRefs(),
    );
    $named = 0;

    foreach ($rows as $row) {
        $page = Page::query()->where('title', $row['title'])->sole();
        $expected = $row['keys'] === '' ? [] : explode(' ', $row['keys']);
        $named += count($expected);

        // every key of the seed is a reference to its item, recorded in the table as CreatePage records it
        expect($keys($page->content))->toBe($expected, $row['title'])
            ->and(DB::table('page_item_references')->where('page_id', $page->id)->pluck('work_item_id')->sort()->values()->all())
            ->toBe(collect($expected)->map(fn (string $key) => ItemsSeeder::find($key)?->id)->sort()->values()->all(), $row['title']);
    }

    $form = Page::query()->where('title', 'Kontaktformular – Technik')->sole();
    $release = Page::query()->where('title', 'Release-Checkliste')->sole();
    $structure = Page::query()->where('title', 'Seitenstruktur')->sole();
    expect($named)->toBe(8)
        ->and($asWritten($form->content))->toContain('Unter Safari kann der Absende-Button doppelt auslösen, siehe WEB-47. Bis zur Lösung')
        ->and($asWritten($release->content))->toContain('Release-Notes geschrieben (APP-16)')
        // the kept version numbered like the page names the same item
        ->and($keys((array) $structure->versions()->where('version', $structure->version)->sole()->content))->toBe(['WEB-48']);
});

it('keeps a key without an item as text', function () {
    $this->seed(DemoSeeder::class);
    Page::query()->where('title', 'Performance-Budget')->delete();
    ItemsSeeder::find('WEB-56')?->delete();

    (new PagesSeeder)->run();
    $page = Page::query()->where('title', 'Performance-Budget')->sole();

    expect($page->content_text)->toContain('Die Prüfung in der CI folgt mit WEB-56.')
        ->and(Document::fromJson($page->content)->itemRefs())->toBe([])
        ->and(DB::table('page_item_references')->where('page_id', $page->id)->count())->toBe(0);
});

it('changes nothing on a second run, keeps what somebody changed and brings back a page that is gone', function () use ($snapshot) {
    $this->seed(DemoSeeder::class);
    $before = $snapshot();

    (new PagesSeeder)->run();
    expect($snapshot())->toBe($before);

    // a page somebody wrote on stays as it is; a deleted one comes back with its versions, below its parent
    $handbook = Page::query()->where('title', 'Projekt-Handbuch')->sole();
    $handbook->forceFill(['content' => null, 'content_text' => null, 'version' => 9])->save();
    $structure = Page::query()->where('title', 'Seitenstruktur')->sole();
    $structure->delete();

    (new PagesSeeder)->run();
    $back = Page::query()->where('title', 'Seitenstruktur')->sole();

    expect($handbook->fresh()?->version)->toBe(9)
        ->and($handbook->fresh()?->content)->toBeNull()
        ->and(Page::count())->toBe(19)
        ->and($back->id)->not->toBe($structure->id)
        ->and($back->parent_id)->toBe($handbook->id)
        ->and($back->versions()->count())->toBe(3)
        ->and(PageVersion::query()->where('page_id', $structure->id)->count())->toBe(0);
});
