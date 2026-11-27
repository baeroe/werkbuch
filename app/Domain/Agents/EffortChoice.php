<?php

namespace App\Domain\Agents;

/**
 * The effort of a run (WEBU-66), chosen when it is queued like its model (ModelChoice); the first stage that names one
 * the CLI takes wins: an effort label of the item (the first in catalog order; a child of an epic without one takes the
 * epic's), the project for the kind, the bot for the kind, the bot's default. None at all: no effort goes to the CLI,
 * it takes its own default.
 */
final class EffortChoice
{
    /**
     * @param  list<array{id: string, effort: string}>  $labels  effort labels of the item in catalog order
     * @param  list<array{id: string, effort: string}>  $epicLabels  those of its epic
     * @param  array<string, string>  $project  kind → effort
     * @param  array<string, string>  $bot  kind → effort
     * @return array{effort: string|null, source: string|null}
     */
    public static function choose(AgentCli $cli, RunType $type, array $labels, array $epicLabels, array $project, array $bot, ?string $botDefault): array
    {
        $takes = fn (mixed $effort): bool => is_string($effort) && in_array($effort, $cli->efforts(), true);

        foreach ($labels === [] ? $epicLabels : $labels as $label) {
            if ($takes($label['effort'])) {
                return ['effort' => $label['effort'], 'source' => 'label'];
            }
        }

        foreach (['project' => $project[$type->value] ?? null, 'bot' => $bot[$type->value] ?? null, 'default' => $botDefault] as $source => $effort) {
            if ($takes($effort)) {
                /** @var string $effort */
                return ['effort' => $effort, 'source' => $source];
            }
        }

        return ['effort' => null, 'source' => null];
    }
}
