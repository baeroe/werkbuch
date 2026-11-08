<?php

namespace Database\Seeders\Demo;

use App\Models\Page;
use App\Models\PageVersion;
use App\Models\Project;
use App\Models\User;
use App\RichText\Document;
use App\Support\PageItemReferences;
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
     * The pages in the order of the seed, a parent before its children: id (the seed's, for the parents), project,
     * parent, rank, emoji, title, creator, created, updated (else created), version (else 1), last saved by (else the
     * creator), and the text as blocks: `['p', text]`, `['h', level, text]`, `['ul', items]`, `['ol', items]`,
     * `['code', text]`.
     *
     * @var list<array{id: string, project: string, parent?: string, rank: string, emoji: string, title: string, by: string, created: string, updated?: string, version?: int, updatedBy?: string, content: list<list<mixed>>}>
     */
    private const PAGES = [
        // WEB
        [
            'id' => 'web_handbook', 'project' => 'WEB', 'rank' => 'a0', 'emoji' => '📘', 'title' => 'Projekt-Handbuch', 'by' => 'ida', 'created' => '09-14 10:00',
            'content' => [
                ['p', 'Dieses Handbuch bündelt, was das Team für den Website-Relaunch braucht: Struktur, Gestaltung, Technik und Absprachen.'],
                ['h', 2, 'Inhalt'],
                ['ul', ['Seitenstruktur: welche Seiten es gibt und wie sie zusammenhängen', 'Designsystem: Farben, Schrift und Abstände', 'Redaktion: Tonalität und Ablauf der Texte', 'Technik: Formular, Hosting und Performance']],
                ['p', 'Offene Fragen sammeln wir als Items im Epic WEB-30.'],
            ],
        ],
        [
            'id' => 'web_structure', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a0', 'emoji' => '🧭', 'title' => 'Seitenstruktur', 'by' => 'ida',
            'created' => '10-02 14:00', 'updated' => '10-14 11:00', 'version' => 3,
            'content' => [
                ['h', 2, 'Navigation'],
                ['ul', ['Start', 'Leistungen (Beratung, Umsetzung, Betrieb)', 'Referenzen', 'Journal', 'Über uns', 'Anfahrt', 'Impressum und Datenschutz']],
                ['h', 2, 'Stand'],
                ['p', 'Abgestimmt mit Studio Nordlicht am 6.10. Offen ist die Reihenfolge der Referenzen.'],
                ['p', 'Die Navigation für Mobilgeräte folgt in WEB-48.'],
            ],
        ],
        [
            'id' => 'web_design', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a1', 'emoji' => '🎨', 'title' => 'Designsystem', 'by' => 'lene', 'created' => '10-02 15:30',
            'content' => [
                ['p', 'Das Designsystem hält Farben, Schrift und Abstände fest, damit Seiten und Bausteine zusammenpassen.'],
                ['ul', ['Die Werte liegen als CSS-Variablen vor', 'Bausteine werden einmal gebaut und wiederverwendet', 'Kontraste folgen WCAG 2.2 AA']],
            ],
        ],
        [
            'id' => 'web_typography', 'project' => 'WEB', 'parent' => 'web_design', 'rank' => 'a0', 'emoji' => '🔤', 'title' => 'Typografie und Farben', 'by' => 'lene', 'created' => '10-09 11:00',
            'content' => [
                ['h', 2, 'Schrift'],
                ['p', 'Überschriften in einer kräftigen Grotesk, Fließtext in einer ruhigen Sans.'],
                ['h', 2, 'Farben'],
                ['ul', ['Tiefblau für Akzente und Links', 'Warmes Grau für Flächen', 'Ein gedecktes Gelb nur für Markierungen']],
            ],
        ],
        [
            'id' => 'web_editorial', 'project' => 'WEB', 'parent' => 'web_handbook', 'rank' => 'a2', 'emoji' => '✍️', 'title' => 'Redaktion und Tonalität', 'by' => 'ida', 'created' => '10-03 09:40',
            'content' => [
                ['p', 'Wir schreiben direkt und freundlich, ohne Fachjargon. Sätze bleiben kurz.'],
                ['h', 2, 'Ablauf'],
                ['ol', ['Der Kunde liefert den Rohtext.', 'Die Redaktion kürzt und gliedert.', 'Der Kunde gibt frei.', 'Die Texte gehen ins CMS.']],
            ],
        ],
        [
            'id' => 'web_tech', 'project' => 'WEB', 'rank' => 'a1', 'emoji' => '🛠️', 'title' => 'Technik', 'by' => 'jonas', 'created' => '09-16 13:00',
            'content' => [['p', 'Technische Entscheidungen und Betriebswissen zur neuen Website.']],
        ],
        [
            'id' => 'web_contactform', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a0', 'emoji' => '📮', 'title' => 'Kontaktformular – Technik', 'by' => 'jonas',
            'created' => '10-16 10:30', 'updated' => '10-27 11:40', 'version' => 2, 'updatedBy' => 'jonas',
            'content' => [
                ['p', 'Das Formular prüft die Eingaben im Browser und noch einmal auf dem Server. Die Mails gehen über den zentralen Mailserver raus.'],
                ['h', 2, 'Ablauf'],
                ['ol', ['Eingaben prüfen', 'Spam-Schutz mit Honeypot und Zeitprüfung', 'Mail an das Team, Bestätigung an die absendende Person']],
                ['h', 2, 'Bekanntes Problem'],
                ['p', 'Unter Safari kann der Absende-Button doppelt auslösen, siehe WEB-47. Bis zur Lösung hilft ein Einmal-Token pro Seitenaufruf.'],
            ],
        ],
        [
            'id' => 'web_hosting', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a1', 'emoji' => '🚀', 'title' => 'Deployment und Hosting', 'by' => 'jonas', 'created' => '10-01 16:00',
            'content' => [
                ['p', 'Die Seite läuft auf dem neuen Server in einem Docker-Stack. Deployments laufen über die CI.'],
                ['ul', ['Staging wird bei jedem Merge aktualisiert', 'Produktion wird nach Freigabe ausgerollt', 'Die Backups laufen nachts']],
            ],
        ],
        [
            'id' => 'web_domain', 'project' => 'WEB', 'parent' => 'web_hosting', 'rank' => 'a0', 'emoji' => '🌐', 'title' => 'Domain-Umzug', 'by' => 'jonas',
            'created' => '10-13 14:20', 'updated' => '10-27 16:30', 'version' => 2, 'updatedBy' => 'jonas',
            'content' => [
                ['h', 2, 'Checkliste'],
                ['ol', ['TTL der DNS-Einträge senken', 'Neuen Server prüfen', 'DNS umstellen', 'Zertifikat prüfen', 'Alte Instanz als Fallback behalten']],
                ['p', 'Erledigt am 27.10., siehe WEB-39.'],
            ],
        ],
        [
            'id' => 'web_performance', 'project' => 'WEB', 'parent' => 'web_tech', 'rank' => 'a2', 'emoji' => '⚡', 'title' => 'Performance-Budget', 'by' => 'mara', 'created' => '10-20 10:00',
            'content' => [
                ['p', 'Ziele für die Startseite auf einem mittleren Smartphone im Mobilfunknetz.'],
                ['ul', ['Largest Contentful Paint unter 2,5 s', 'Gesamtgewicht unter 1 MB', 'Keine Layout-Sprünge beim Laden']],
                ['p', 'Die Prüfung in der CI folgt mit WEB-56.'],
            ],
        ],
        [
            'id' => 'web_meetings', 'project' => 'WEB', 'rank' => 'a2', 'emoji' => '📅', 'title' => 'Meetings', 'by' => 'ida', 'created' => '09-14 12:00',
            'content' => [['p', 'Notizen aus den Terminen mit dem Team und dem Kunden.']],
        ],
        [
            'id' => 'web_kickoff', 'project' => 'WEB', 'parent' => 'web_meetings', 'rank' => 'a0', 'emoji' => '📝', 'title' => 'Kickoff-Notizen', 'by' => 'ida', 'created' => '09-14 17:15',
            'content' => [
                ['h', 2, 'Kickoff am 14.9.'],
                ['ul', ['Ziel ist eine schnellere, barrierearme Website', 'Phase 1 bis 15.11., Phase 2 im Frühjahr', 'Ansprechpartnerin beim Kunden ist Frau Nordlund']],
                ['p', 'Nächster Termin: Abstimmung der Seitenstruktur.'],
            ],
        ],
        // APP
        [
            'id' => 'app_vision', 'project' => 'APP', 'rank' => 'a0', 'emoji' => '🎯', 'title' => 'Produktvision', 'by' => 'theo', 'created' => '07-06 11:00',
            'content' => [
                ['p', 'Die App macht Bestellungen für die Kundinnen und Kunden von Hafenkontor so einfach wie möglich: wenige Schritte, klare Status, nichts Überflüssiges.'],
                ['h', 2, 'Ziele der Version 2.0'],
                ['ul', ['Anmeldung mit Biometrie', 'Push-Mitteilungen zu Bestellungen', 'Bestellliste auch offline']],
            ],
        ],
        [
            'id' => 'app_api', 'project' => 'APP', 'rank' => 'a1', 'emoji' => '🔌', 'title' => 'API-Schnittstelle', 'by' => 'jonas', 'created' => '07-20 09:30',
            'content' => [
                ['p', 'Die App spricht mit der Shop-API des Kunden. Alle Aufrufe laufen über einen Proxy, der die Tokens verwaltet.'],
                ['code', 'GET /v2/orders?status=open'],
                ['p', 'Die Zugangsdaten liegen im Passwortmanager, nicht im Repository.'],
            ],
        ],
        [
            'id' => 'app_approval', 'project' => 'APP', 'rank' => 'a2', 'emoji' => '✅', 'title' => 'Freigabeprozess', 'by' => 'theo', 'created' => '07-08 15:00',
            'content' => [
                ['p', 'Items durchlaufen im Workflow „Agentur-Freigabe“ erst die interne Prüfung (Review) und danach die Kundenfreigabe.'],
                ['ol', ['Review durch eine zweite Person aus dem Team', 'Kundenfreigabe mit einem Testbuild', 'Abschluss in Done']],
                ['p', 'Aus Todo geht es nur nach In Progress oder Cancelled.'],
            ],
        ],
        [
            'id' => 'app_release', 'project' => 'APP', 'parent' => 'app_approval', 'rank' => 'a0', 'emoji' => '📦', 'title' => 'Release-Checkliste', 'by' => 'theo', 'created' => '10-19 10:00',
            'content' => [
                ['ul', ['Release-Notes geschrieben (APP-16)', 'TestFlight-Gruppe eingerichtet (APP-18)', 'Store-Screenshots aktualisiert', 'Datenschutzerklärung geprüft']],
            ],
        ],
        // OPS
        [
            'id' => 'ops_servers', 'project' => 'OPS', 'rank' => 'a0', 'emoji' => '🖥️', 'title' => 'Server-Übersicht', 'by' => 'jonas', 'created' => '08-28 10:00',
            'content' => [
                ['p', 'Zwei Anwendungsserver und ein Datenbankserver, alle hinter einem Load Balancer.'],
                ['ul', ['app-1 und app-2: Docker-Stack', 'db-1: Primär mit Replikat', 'mail-1: Postfix']],
            ],
        ],
        [
            'id' => 'ops_runbook', 'project' => 'OPS', 'parent' => 'ops_servers', 'rank' => 'a0', 'emoji' => '🚨', 'title' => 'Runbook: Störung', 'by' => 'jonas', 'created' => '09-30 17:00',
            'content' => [
                ['h', 2, 'Erste Schritte'],
                ['ol', ['Status im Monitoring prüfen', 'Letztes Deployment ansehen', 'Logs der betroffenen Dienste lesen', 'Bei Bedarf auf das letzte stabile Image zurückrollen']],
                ['p', 'Eskalation: Jonas, danach Mara.'],
            ],
        ],
        [
            'id' => 'ops_backup', 'project' => 'OPS', 'rank' => 'a1', 'emoji' => '💾', 'title' => 'Backup und Restore', 'by' => 'mara', 'created' => '10-01 12:00',
            'content' => [
                ['p', 'Nachts um 03:00 läuft ein vollständiges Backup, tagsüber stündlich ein Inkrement.'],
                ['p', 'Der Restore-Test steht als OPS-14 an.'],
            ],
        ],
    ];

    /**
     * The kept versions by page (the seed's id): number, author, time and text; `null` for the version numbered like the
     * page, which is its current title and text (the clickdummy clones it).
     *
     * @var array<string, list<array{version: int, by: string, at: string, content: list<list<mixed>>|null}>>
     */
    private const VERSIONS = [
        'web_structure' => [
            ['version' => 1, 'by' => 'ida', 'at' => '10-02 14:00', 'content' => [
                ['h', 2, 'Navigation'],
                ['ul', ['Start', 'Leistungen', 'Referenzen', 'Über uns', 'Impressum']],
            ]],
            ['version' => 2, 'by' => 'ida', 'at' => '10-06 16:20', 'content' => [
                ['h', 2, 'Navigation'],
                ['ul', ['Start', 'Leistungen (Beratung, Umsetzung, Betrieb)', 'Referenzen', 'Journal', 'Über uns', 'Anfahrt', 'Impressum']],
                ['p', 'Abgestimmt mit Studio Nordlicht am 6.10.'],
            ]],
            ['version' => 3, 'by' => 'ida', 'at' => '10-14 11:00', 'content' => null],
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
        /** @var array<string, string> $ids the seed's id → the id of the page with that title now */
        $ids = [];

        foreach (self::PAGES as $row) {
            $project = $projects[$row['project']] ?? throw new RuntimeException("No project {$row['project']}.");
            $existing = Page::query()->where('project_id', $project)->where('title', $row['title'])->orderBy('id')->value('id');
            $ids[$row['id']] = is_string($existing) ? $existing : $this->create($project, $row, $ids, $people);
        }
    }

    /**
     * @param  array{id: string, project: string, parent?: string, rank: string, emoji: string, title: string, by: string, created: string, updated?: string, version?: int, updatedBy?: string, content: list<list<mixed>>}  $row
     * @param  array<array-key, string>  $ids  the seed's id → the id of the page
     * @param  Collection<string, string>  $people
     */
    private function create(string $project, array $row, array $ids, Collection $people): string
    {
        $content = $this->document($row['content']);
        $updatedAt = ItemsSeeder::at($row['updated'] ?? $row['created']);

        $page = new Page;
        $page->forceFill([
            'project_id' => $project,
            'parent_id' => isset($row['parent']) ? $ids[$row['parent']] : null,
            'rank' => $row['rank'],
            'title' => $row['title'],
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
            if ($current !== ($kept['content'] === null)) {
                throw new RuntimeException("Only version {$page->version} of „{$row['title']}“ is its text now.");
            }

            (new PageVersion)->forceFill([
                'page_id' => $page->id,
                'version' => $kept['version'],
                'title' => $page->title,
                'content' => $kept['content'] === null ? $page->content : $this->document($kept['content'])->toJson(),
                'author_id' => self::person($people, $kept['by']),
                'created_at' => ItemsSeeder::at($kept['at']),
            ])->save();
        }

        return $page->id;
    }

    /**
     * The text as the clickdummy's helpers build it (`doc`, `p`, `h`, `ul`, `ol`, `code`), read as the API reads Tiptap
     * JSON; a key with an item becomes a reference outside code.
     *
     * @param  list<list<mixed>>  $blocks
     */
    private function document(array $blocks): Document
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
        }, $blocks)]);
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
