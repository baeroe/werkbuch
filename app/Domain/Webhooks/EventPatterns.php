<?php

namespace App\Domain\Webhooks;

use App\Domain\Filter\InvalidInput;

/**
 * The events a webhook subscribes to (spec 6.3): single names of the catalog (`work_item.state_changed`) and the
 * wildcard of a group (`work_item.*`, the part before the first dot). The catalog is the list of event names a webhook
 * can subscribe to (`EventType::webhook()`); the callers pass it, so this rule knows nothing of the event types.
 */
final class EventPatterns
{
    public const WILDCARD = '.*';

    /**
     * The normal form to store: a group with every event of the catalog chosen becomes its wildcard alone, the other
     * events keep their names; groups and events in the order of the catalog, without doubles.
     *
     * @param  list<string>  $patterns
     * @param  list<string>  $catalog
     * @return list<string>
     *
     * @throws InvalidInput `['events' => 'unknown:<name>']` for the first name outside the catalog
     */
    public static function normalize(array $patterns, array $catalog): array
    {
        $groups = self::groups($catalog);
        foreach ($patterns as $pattern) {
            if (! in_array($pattern, $catalog, true) && ! array_key_exists(self::groupOf($pattern), $groups)) {
                throw new InvalidInput(['events' => 'unknown:'.$pattern]);
            }
        }

        $chosen = self::expand($patterns, $catalog);
        $normal = [];
        foreach ($groups as $group => $events) {
            $ticked = array_values(array_intersect($events, $chosen));
            if ($ticked === $events) {
                $normal[] = $group.self::WILDCARD;
            } else {
                array_push($normal, ...$ticked);
            }
        }

        return $normal;
    }

    /**
     * Whether the patterns take the event. An event outside the catalog never matches, also not a wildcard of its
     * group (`comment.*` does not take `comment.reaction_added`).
     *
     * @param  list<string>  $patterns
     * @param  list<string>  $catalog
     */
    public static function matches(array $patterns, string $event, array $catalog): bool
    {
        return in_array($event, self::expand($patterns, $catalog), true);
    }

    /**
     * The events of the catalog the patterns stand for, in the order of the catalog. Patterns that are not (or no
     * longer) in the catalog stand for nothing.
     *
     * @param  list<string>  $patterns
     * @param  list<string>  $catalog
     * @return list<string>
     */
    public static function expand(array $patterns, array $catalog): array
    {
        return array_values(array_filter($catalog, fn (string $event) => in_array($event, $patterns, true)
            || in_array(explode('.', $event, 2)[0].self::WILDCARD, $patterns, true)));
    }

    /**
     * The events of the catalog by group, both in the order of the catalog.
     *
     * @param  list<string>  $catalog
     * @return array<string, list<string>>
     */
    private static function groups(array $catalog): array
    {
        $groups = [];
        foreach (array_unique($catalog) as $event) {
            $groups[explode('.', $event, 2)[0]][] = $event;
        }

        return $groups;
    }

    /**
     * The group a wildcard names (`work_item` for `work_item.*`), `''` for anything else.
     */
    private static function groupOf(string $pattern): string
    {
        return str_ends_with($pattern, self::WILDCARD) ? substr($pattern, 0, -strlen(self::WILDCARD)) : '';
    }
}
