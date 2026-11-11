<?php

namespace Database\Seeders\Load;

use App\RichText\Document;
use JsonException;

/**
 * The texts of the load data (K9): a fixed pool of descriptions and comments, built once from blocks (paragraph, list,
 * code, a mention of a load person, a reference to an item of the same project) as Tiptap JSON. No Markdown, no
 * RichTextRules: reading Markdown takes up to a second per text, the rules ask the database per text. Each entry is
 * read once through Document::fromJson() (the stored normal form) and its plain text comes from toText() once, never per
 * row; a reference carries no text, so a row only puts the id of its target in place of TARGET.
 */
final class LoadTexts
{
    public const POOL = 200;

    /** Stands for the item a reference points to; replaced per row (a valid ULID, so the document reads it). */
    public const TARGET = '00000000000000000000000000';

    /** Words the titles and texts are made of: search finds them (Task 11b), every word occurs often. */
    public const WORDS = [
        'Anmeldung', 'Formular', 'Startseite', 'Suche', 'Export', 'Import', 'Bericht', 'Rechnung', 'Kalender', 'Profil',
        'Navigation', 'Tabelle', 'Filter', 'Benachrichtigung', 'Upload', 'Vorschau', 'Schnittstelle', 'Datenbank', 'Cache',
        'Warteschlange', 'Zahlung', 'Bestellung', 'Lieferung', 'Kontakt', 'Newsletter', 'Archiv', 'Dashboard', 'Statistik',
        'Rechte', 'Rolle', 'Passwort', 'Sitzung', 'Server', 'Backup', 'Zertifikat', 'Protokoll', 'Übersetzung', 'Layout',
        'Schrift', 'Farbe', 'Bild', 'Video', 'Kommentar', 'Vorlage', 'Zeitplan', 'Webhook', 'Drucken', 'Sortierung',
    ];

    public const VERBS = [
        'prüfen', 'anpassen', 'beheben', 'umbauen', 'testen', 'beschleunigen', 'vereinfachen', 'dokumentieren', 'einrichten',
        'aufräumen', 'übersetzen', 'absichern', 'erweitern', 'migrieren', 'abstimmen', 'freigeben',
    ];

    private const LANGUAGES = ['php', 'typescript', 'sql', 'bash', null];

    /** @var list<array{json: string, text: string}> */
    public readonly array $descriptions;

    /** @var list<array{json: string, text: string}> */
    public readonly array $comments;

    /**
     * @param  list<array{id: string, handle: string}>  $people  who a text mentions
     */
    public function __construct(private readonly array $people)
    {
        $this->descriptions = $this->pool(fn () => $this->description());
        $this->comments = $this->pool(fn () => $this->comment());
    }

    /**
     * A title of words of the vocabulary (`Formular Export prüfen`).
     */
    public static function title(): string
    {
        return self::word().' '.self::word().' '.self::VERBS[LoadRandom::int(0, count(self::VERBS) - 1)];
    }

    /**
     * The stored JSON of an entry with its reference pointing at `$target`.
     *
     * @param  array{json: string, text: string}  $entry
     */
    public static function pointedAt(array $entry, string $target): string
    {
        return str_replace(self::TARGET, $target, $entry['json']);
    }

    /**
     * @param  callable(): array<string, mixed>  $make
     * @return list<array{json: string, text: string}>
     *
     * @throws JsonException
     */
    private function pool(callable $make): array
    {
        $pool = [];
        for ($i = 0; $i < self::POOL; $i++) {
            $document = Document::fromJson($make());
            $pool[] = ['json' => json_encode($document->toJson(), JSON_THROW_ON_ERROR), 'text' => $document->toText()];
        }

        return $pool;
    }

    /**
     * One to four blocks; most descriptions mention a person and point at another item in their first paragraph.
     *
     * @return array<string, mixed>
     */
    private function description(): array
    {
        $blocks = [$this->paragraph(LoadRandom::int(1, 10) <= 8, LoadRandom::chance(7))];
        $more = LoadRandom::int(0, 3);

        for ($i = 0; $i < $more; $i++) {
            $blocks[] = match (LoadRandom::int(0, 2)) {
                0 => $this->paragraph(false, false),
                1 => $this->list(),
                default => $this->code(),
            };
        }

        return ['type' => 'doc', 'content' => $blocks];
    }

    /**
     * One paragraph, sometimes a second; about half mention somebody or point at an item.
     *
     * @return array<string, mixed>
     */
    private function comment(): array
    {
        $blocks = [$this->paragraph(LoadRandom::int(0, 1) === 1, LoadRandom::chance(4))];
        if (LoadRandom::chance(3)) {
            $blocks[] = LoadRandom::int(0, 1) === 1 ? $this->list() : $this->code();
        }

        return ['type' => 'doc', 'content' => $blocks];
    }

    /**
     * @return array<string, mixed>
     */
    private function paragraph(bool $mention, bool $reference): array
    {
        $content = [self::text(self::sentence(LoadRandom::int(6, 14)).' ')];

        if ($mention) {
            $person = $this->people[LoadRandom::int(0, count($this->people) - 1)];
            $content[] = ['type' => 'mention', 'attrs' => ['id' => $person['id'], 'label' => $person['handle'], 'mentionSuggestionChar' => '@']];
            $content[] = self::text(' bitte '.self::VERBS[LoadRandom::int(0, count(self::VERBS) - 1)].'.');
        }

        if ($reference) {
            $content[] = self::text(' Hängt an ');
            $content[] = ['type' => 'reference', 'attrs' => ['id' => self::TARGET, 'label' => null, 'mentionSuggestionChar' => '#', 'kind' => 'item']];
            $content[] = self::text('.');
        }

        return ['type' => 'paragraph', 'content' => $content];
    }

    /**
     * @return array<string, mixed>
     */
    private function list(): array
    {
        $items = [];
        $count = LoadRandom::int(2, 4);
        for ($i = 0; $i < $count; $i++) {
            $items[] = ['type' => 'listItem', 'content' => [['type' => 'paragraph', 'content' => [self::text(self::sentence(LoadRandom::int(3, 7)))]]]];
        }

        return ['type' => 'bulletList', 'content' => $items];
    }

    /**
     * @return array<string, mixed>
     */
    private function code(): array
    {
        $lines = [];
        $count = LoadRandom::int(1, 5);
        for ($i = 0; $i < $count; $i++) {
            $lines[] = strtolower(self::word()).'_'.strtolower(self::word()).'('.LoadRandom::int(1, 999).');';
        }

        return ['type' => 'codeBlock', 'attrs' => ['language' => self::LANGUAGES[LoadRandom::int(0, count(self::LANGUAGES) - 1)]], 'content' => [self::text(implode("\n", $lines))]];
    }

    private static function sentence(int $words): string
    {
        $sentence = [];
        for ($i = 0; $i < $words; $i++) {
            $sentence[] = LoadRandom::int(0, 3) === 0 ? self::VERBS[LoadRandom::int(0, count(self::VERBS) - 1)] : self::word();
        }

        return implode(' ', $sentence).'.';
    }

    private static function word(): string
    {
        return self::WORDS[LoadRandom::int(0, count(self::WORDS) - 1)];
    }

    /**
     * @return array{type: 'text', text: string}
     */
    private static function text(string $text): array
    {
        return ['type' => 'text', 'text' => $text];
    }
}
