<?php

namespace App\Support;

use App\Domain\Agents\RunType;
use App\Enums\Locale;
use App\Models\AgentRule;

/**
 * The working rules of the organization per kind of run (spec 7.3, layer 2): the text of the organization where it
 * changed one, else the standard werkbuch ships (`resources/agents/rules/<locale>/<kind>.md`) in the language of the
 * organization. A text that equals a standard in either language is no change (SaveAgentRule keeps no row for it): so a
 * new standard of a release reaches exactly the texts nobody changed.
 */
final class AgentRules
{
    /** The standard of a kind in a language. */
    public static function standard(RunType $type, Locale $locale): string
    {
        return self::normal((string) file_get_contents(resource_path("agents/rules/{$locale->value}/{$type->value}.md")));
    }

    /** Whether a text is a standard of the kind (in any language). */
    public static function isStandard(RunType $type, string $text): bool
    {
        foreach (Locale::cases() as $locale) {
            if (self::normal($text) === self::standard($type, $locale)) {
                return true;
            }
        }

        return false;
    }

    /** The rules a run of the kind gets. */
    public static function text(RunType $type): string
    {
        return AgentRule::query()->where('type', $type->value)->value('body') ?? self::standard($type, Locale::default());
    }

    /**
     * The rules of every kind, in the order of the kinds: the text, whether it is the standard.
     *
     * @return list<array{type: RunType, body: string, standard: bool}>
     */
    public static function all(): array
    {
        $own = AgentRule::query()->pluck('body', 'type')->all();

        return array_map(fn (RunType $type) => [
            'type' => $type,
            'body' => $own[$type->value] ?? self::standard($type, Locale::default()),
            'standard' => ! isset($own[$type->value]),
        ], RunType::cases());
    }

    /** One way of writing a text: Unix line ends, no blank lines at its ends. */
    public static function normal(string $text): string
    {
        return trim(str_replace(["\r\n", "\r"], "\n", $text));
    }
}
