<?php

namespace Tests\Support;

use Database\Seeders\Demo\Texts\English;
use Database\Seeders\Demo\Texts\German;

/**
 * The demo texts that read the same in German and English, each with its reason. Any other key whose English text
 * equals the German one is an untranslated copy (`Kundenfreigabe`, `Formulare`, a title nobody translated): no word
 * list catches those, comparing key by key does.
 */
final class SharedDemoTexts
{
    /** @var array<string, string> key → why both languages share the text */
    public const KEYS = [
        'person.theo.name' => 'a name',
        'bot.kira.name' => 'a name',
        'catalog.workflow.standard.name' => 'the shipped workflow is „Standard“ in both languages (lang/*.json)',
        'catalog.state.backlog' => 'state names are English in both languages (spec)',
        'catalog.state.todo' => 'state names are English in both languages (spec)',
        'catalog.state.progress' => 'state names are English in both languages (spec)',
        'catalog.state.review' => 'state names are English in both languages (spec)',
        'catalog.state.pending' => 'state names are English in both languages (spec)',
        'catalog.state.done' => 'state names are English in both languages (spec)',
        'catalog.state.cancelled' => 'state names are English in both languages (spec)',
        'catalog.property.environment.option.staging' => 'a technical term in both languages',
        'catalog.property.browser.label' => 'the same word in both languages',
        'catalog.property.reviewer.label' => 'the same word in both languages',
        'catalog.property.target_quarter.option.q4_2026' => 'a quarter',
        'catalog.property.target_quarter.option.q1_2027' => 'a quarter',
        'catalog.property.target_quarter.option.q2_2027' => 'a quarter',
        'catalog.type.task.name' => 'type names are English in both languages (spec)',
        'catalog.type.bug.name' => 'type names are English in both languages (spec)',
        'catalog.type.epic.name' => 'type names are English in both languages (spec)',
        'catalog.label.ux' => 'an abbreviation',
        'catalog.label.performance' => 'the same word in both languages',
        'catalog.label.seo' => 'an abbreviation',
        'catalog.label.backend' => 'the same word in both languages',
        'catalog.label.design' => 'the same word in both languages',
        'view.roadmap.name' => 'the same word in both languages',
        'token.claude_code.name' => 'a product name',
        'token.mcp.name' => 'an abbreviation',
        'file.OPS-12.1.name' => 'the name of a configuration file of Postfix',
    ];

    /** @var array<string, string> key → why it is no text a reader sees */
    public const NOT_TEXTS = [
        'file.folder' => 'the folder of the demo files, a path',
    ];

    /**
     * German in a text: a letter English does not have, or a German word as a whole word. The first one found, else
     * null.
     */
    public static function germanIn(string $text): ?string
    {
        if (preg_match('/[äöüßÄÖÜ]|\b(?:und|der|die|das|nicht|mit|für|ist)\b/iu', $text, $match) === 1) {
            return $match[0];
        }

        return null;
    }

    /**
     * The keys whose English text is the German one without a reason.
     *
     * @param  array<string, string>  $english
     * @return list<string>
     */
    public static function untranslated(array $english = English::TEXTS): array
    {
        $copies = array_filter(
            array_keys(German::TEXTS),
            fn (string $key) => ($english[$key] ?? null) === German::TEXTS[$key] && ! isset(self::KEYS[$key]),
        );

        return array_values($copies);
    }

    /**
     * The German texts no English text may hold: all but the shared ones and those that are no text (a path).
     *
     * @return list<string>
     */
    public static function germanOnly(): array
    {
        return array_values(array_unique(array_diff_key(German::TEXTS, self::KEYS, self::NOT_TEXTS)));
    }
}
