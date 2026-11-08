<?php

namespace Database\Seeders\Demo;

use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use App\Support\PageItemReferences;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * The wiki of WEB, APP and OPS, every page of the clickdummy seed (src/api/seed/pages.ts; `PagesSeederTest` reads that
 * file and compares page by page) with the three kept versions of „Seitenstruktur“. A text is the Tiptap JSON the
 * clickdummy builds (read through Document::fromJson, as an editor would send it), with one change: a key like `WEB-47`
 * in a paragraph, heading or list item becomes a reference to the item the ItemsSeeder made (A456, the frozen
 * clickdummy keeps it text), so the item detail shows the pages that name it; a key without an item and a key in code
 * stay text. The references go into `page_item_references` as CreatePage writes them (PageItemReferences::sync).
 * Written directly, without events, like the other demo seeders (A86); the search index is built anew at the end of the
 * DemoSeeder. The clickdummy's `simulate_conflict_once` is its own trick and not seeded.
 *
 * Safe to run again, and it never touches a page that exists (like K13): it creates the pages whose (project, title)
 * is missing, with their versions, and nothing else. A page a later run adds goes below the page that has its parent's
 * title (the parents come first), at the rank of the seed. The version numbered like the page is exactly its title and
 * text (T4-M1), so restoring it changes nothing.
 */
class PagesSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * The pages in the order of the seed, a parent before its children: id (the seed's without `pg_`, the key of its
     * texts `page.<id>.title|content`), project, parent, rank, emoji, creator, created, updated (else created), version
     * (else 1) and last saved by (else the creator).
     *
     * @var list<array{id: string, project: string, parent?: string, rank: string, emoji: string, by: string, created: string, updated?: string, version?: int, updatedBy?: string}>
     */
    private const PAGES = [
        // WEB
        ['id' => 'web_handbook', 'project' => 'WEB', 'rank' => 'a0', 'emoji' => '📘', 'by' => 'ida', 'created' => '09-14 10:00'],
        ['id' => 'web_structure', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a0', 'emoji' => '🧭', 'by' => 'ida', 'created' => '10-02 14:00', 'updated' => '10-14 11:00', 'version' => 3],
        ['id' => 'web_design', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a1', 'emoji' => '🎨', 'by' => 'lene', 'created' => '10-02 15:30'],
        ['id' => 'web_typography', 'project' => 'WEB', 'parent' => 'web_design', 'rank' => 'a0', 'emoji' => '🔤', 'by' => 'lene', 'created' => '10-09 11:00'],
        ['id' => 'web_editorial', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a2', 'emoji' => '✍️', 'by' => 'ida', 'created' => '10-03 09:40'],
        ['id' => 'web_tech', 'project' => 'WEB', 'rank' => 'a1', 'emoji' => '🛠️', 'by' => 'jonas', 'created' => '09-16 13:00'],
        ['id' => 'web_contactform', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a0', 'emoji' => '📮', 'by' => 'jonas', 'created' => '10-16 10:30', 'updated' => '10-27 11:40', 'version' => 2, 'updatedBy' => 'jonas'],
        ['id' => 'web_hosting', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a1', 'emoji' => '🚀', 'by' => 'jonas', 'created' => '10-01 16:00'],
        ['id' => 'web_domain', 'project' => 'WEB', 'parent' => 'web_hosting', 'rank' => 'a0', 'emoji' => '🌐', 'by' => 'jonas', 'created' => '10-13 14:20', 'updated' => '10-27 16:30', 'version' => 2, 'updatedBy' => 'jonas'],
        ['id' => 'web_performance', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a2', 'emoji' => '⚡', 'by' => 'mara', 'created' => '10-20 10:00'],
        ['id' => 'web_meetings', 'project' => 'WEB', 'rank' => 'a2', 'emoji' => '📅', 'by' => 'ida', 'created' => '09-14 12:00'],
        ['id' => 'web_kickoff', 'project' => 'WEB', 'parent' => 'web_meetings', 'rank' => 'a0', 'emoji' => '📝', 'by' => 'ida', 'created' => '09-14 17:15'],
        // APP
        ['id' => 'app_vision', 'project' => 'APP', 'rank' => 'a0', 'emoji' => '🎯', 'by' => 'theo', 'created' => '07-06 11:00'],
        ['id' => 'app_api', 'project' => 'APP', 'rank' => 'a1', 'emoji' => '🔌', 'by' => 'jonas', 'created' => '07-20 09:30'],
        ['id' => 'app_approval', 'project' => 'APP', 'rank' => 'a2', 'emoji' => '✅', 'by' => 'theo', 'created' => '07-08 15:00'],
        ['id' => 'app_release', 'project' => 'APP', 'parent' => 'app_approval', 'rank' => 'a0', 'emoji' => '📦', 'by' => 'theo', 'created' => '10-19 10:00'],
        // OPS
        ['id' => 'ops_servers', 'project' => 'OPS', 'rank' => 'a0', 'emoji' => '🖥️', 'by' => 'jonas', 'created' => '08-28 10:00'],
        ['id' => 'ops_runbook', 'project' => 'OPS', 'parent' => 'ops_servers', 'rank' => 'a0', 'emoji' => '🚨', 'by' => 'jonas', 'created' => '09-30 17:00'],
        ['id' => 'ops_backup', 'project' => 'OPS', 'rank' => 'a1', 'emoji' => '💾', 'by' => 'mara', 'created' => '10-01 12:00'],
    ];

    /**
     * The kept versions by page (the seed's id): number, author and time. A version's text is `page.<id>.version.<n>`,
     * but the one numbered like the page: that is its current title and text (the clickdummy clones it).
     *
     * @var array<string, list<array{version: int, by: string, at: string}>>
     */
    private const VERSIONS = [
        'web_structure' => [
            ['version' => 1, 'by' => 'ida', 'at' => '10-02 14:00'],
            ['version' => 2, 'by' => 'ida', 'at' => '10-06 16:20'],
            ['version' => 3, 'by' => 'ida', 'at' => '10-14 11:00'],
        ],
    ];

    /** A key as a whole word: no word character and no `-` on either side (as MentionsAndReferences reads one). */
    private const KEY = '/(?<![\\w-])([A-Z][A-Z0-9]{1,9}-\\d{1,10})(?![\\w-])/u';

    /** @var array<string, ?string> the key → the ID of its item, `null` without one */
    private array $items = [];

    public function run(): void
    {
        // one transaction: a page without its versions would stay so for good (a rerun skips every page that exists)
        DB::transaction(fn () => $this->seed());
    }

    private function seed(): void
    {
        $people = User::query()->pluck('id', 'handle');
        $projects = Project::query()->whereIn('identifier', ['WEB', 'APP', 'OPS'])->pluck('id', 'identifier');
        /** @var array<string, string> $ids the seed's id → the id of the page with its title now */
        $ids = [];

        foreach (self::PAGES as $row) {
            $project = $projects[$row['project']] ?? throw new RuntimeException("No project {$row['project']}.");
            $title = DemoTexts::get("page.{$row['id']}.title");
            $existing = Page::query()->where('project_id', $project)->where('title', $title)->orderBy('id')->value('id');
            $ids[$row['id']] = is_string($existing) ? $existing : $this->create($project, $row, $ids, $people);
        }
    }

    /**
     * @param  array{id: string, project: string, parent?: string, rank: string, emoji: string, by: string, created: string, updated?: string, version?: int, updatedBy?: string}  $row
     * @param  array<array-key, string>  $ids  the seed's id → the id of the page
     * @param  Collection<string, string>  $people
     */
    private function create(string $project, array $row, array $ids, Collection $people): string
    {
        $content = $this->document(DemoTexts::get("page.{$row['id']}.content"));
        $updatedAt = ItemsSeeder::at($row['updated'] ?? $row['created']);

        $page = new Page;
        $page->forceFill([
            'project_id' => $project,
            'parent_id' => isset($row['parent']) ? $ids[$row['parent']] : null,
            'rank' => $row['rank'],
            'title' => DemoTexts::get("page.{$row['id']}.title"),
            'emoji' => $row['emoji'],
            'content' => $content->toJson(),
            'content_text' => $content->toText(),
            'version' => $row['version'] ?? 1,
            'created_by' => self::person($people, $row['by']),
            'updated_by' => self::person($people, $row['updatedBy'] ?? $row['by']),
            'created_at' => ItemsSeeder::at($row['created']),
            'updated_at' => $updatedAt,
        ])->save();
        PageItemReferences::sync($page, $content);

        foreach (self::VERSIONS[$row['id']] ?? [] as $kept) {
            // the version of the page's own number is its state now, nothing else (T4-M1)
            $current = $kept['version'] === $page->version;
            $text = "page.{$row['id']}.version.{$kept['version']}";
            if ($current === DemoTexts::has($text)) {
                throw new RuntimeException("Only version {$page->version} of „{$page->title}“ is its text now.");
            }

            (new PageVersion)->forceFill([
                'page_id' => $page->id,
                'version' => $kept['version'],
                'title' => $page->title,
                'content' => $current ? $page->content : $this->document(DemoTexts::get($text))->toJson(),
                'author_id' => self::person($people, $kept['by']),
                'created_at' => ItemsSeeder::at($kept['at']),
            ])->save();
        }

        return $page->id;
    }

    /**
     * The text as the clickdummy's helpers build it (`doc`, `p`, `h`, `ul`, `ol`, `code`), read as the API reads Tiptap
     * JSON; a key with an item becomes a reference outside code. The demo text writes the blocks a blank line apart:
     * `## heading`, lines of `- item` or `1. item`, a fence of three backticks for code, else one paragraph (never
     * Markdown: that would read a text the way the editor does not build it, with marks and other nodes).
     */
    private function document(string $source): Document
    {
        $text = fn (string $text): array => ['type' => 'text', 'text' => $text];
        $inline = fn (string $line): array => $this->inline($line);
        $paragraph = fn (string $line): array => ['type' => 'paragraph', 'content' => $inline($line)];
        $items = fn (array $lines): array => array_map(fn (string $line) => ['type' => 'listItem', 'content' => [$paragraph($line)]], $lines);

        return Document::fromJson(['type' => 'doc', 'content' => array_map(fn (array $block): array => match ($block[0]) {
            'p' => $paragraph($block[1]),
            'h' => ['type' => 'heading', 'attrs' => ['level' => $block[1]], 'content' => $inline($block[2])],
            'ul' => ['type' => 'bulletList', 'content' => $items($block[1])],
            'ol' => ['type' => 'orderedList', 'attrs' => ['start' => 1], 'content' => $items($block[1])],
            'code' => ['type' => 'codeBlock', 'attrs' => ['language' => null], 'content' => [$text($block[1])]],
            default => throw new RuntimeException("Unknown block {$block[0]}."),
        }, self::blocks($source))]);
    }

    /**
     * The blocks of a demo text, in the form of the clickdummy's helpers: `['p', text]`, `['h', level, text]`,
     * `['ul', items]`, `['ol', items]`, `['code', text]`.
     *
     * @return list<list<mixed>>
     */
    private static function blocks(string $source): array
    {
        $lines = fn (string $block, string $marker): ?array => preg_match_all("/^{$marker}(.+)$/m", $block, $match) === substr_count($block, "\n") + 1 ? $match[1] : null;

        return array_map(function (string $block) use ($lines): array {
            if (preg_match('/\A```\n(.*)\n```\z/s', $block, $code) === 1) {
                return ['code', $code[1]];
            }
            if (preg_match('/\A(#{1,3}) ([^\n]+)\z/', $block, $heading) === 1) {
                return ['h', strlen($heading[1]), $heading[2]];
            }

            return match (true) {
                ($items = $lines($block, '- ')) !== null => ['ul', $items],
                ($items = $lines($block, '\d+\. ')) !== null => ['ol', $items],
                ! str_contains($block, "\n") => ['p', $block],
                default => throw new RuntimeException("A demo text has a block of several lines that is no list: {$block}"),
            };
        }, explode("\n\n", $source));
    }

    /**
     * The inline nodes of a line: text, and a reference for every key whose item there is.
     *
     * @return list<array<string, mixed>>
     */
    private function inline(string $line): array
    {
        $nodes = [];
        foreach (preg_split(self::KEY, $line, -1, PREG_SPLIT_DELIM_CAPTURE) ?: [] as $i => $part) {
            $id = $i % 2 === 1 ? $this->item($part) : null;
            $nodes[] = $id === null
                ? ['type' => 'text', 'text' => $part]
                : ['type' => 'reference', 'attrs' => ['id' => $id, 'label' => null, 'mentionSuggestionChar' => '#', 'kind' => 'item']];
        }

        // an empty text between two nodes is no node (Document::fromJson refuses it)
        return array_values(array_filter($nodes, fn (array $node) => $node['type'] !== 'text' || $node['text'] !== ''));
    }

    /** The ID of the item of a key, `null` when the demo has none. */
    private function item(string $key): ?string
    {
        if (! array_key_exists($key, $this->items)) {
            $this->items[$key] = ItemsSeeder::find($key)?->id;
        }

        return $this->items[$key];
    }

    /**
     * @param  Collection<string, string>  $people
     */
    private static function person(Collection $people, string $handle): string
    {
        return $people[$handle] ?? throw new RuntimeException("No account @{$handle}.");
    }
}
