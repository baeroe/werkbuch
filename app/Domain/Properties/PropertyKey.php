<?php

namespace App\Domain\Properties;

/**
 * The key of a custom property (spec 4.7): snake_case, at most 40 characters, never a core field. Uniqueness and
 * immutability are the actions' job.
 */
final class PropertyKey
{
    public const PATTERN = '/^[a-z][a-z0-9_]{0,39}\z/';

    /** The keys of the core fields of a work item (`CORE_KEYS` in the clickdummy). */
    public const CORE = [
        'id', 'key', 'project', 'type', 'title', 'description', 'state', 'state_category', 'resolution', 'assignee', 'priority',
        'label', 'labels', 'start_date', 'due_date', 'parent', 'created_by', 'created_at', 'updated_at', 'started_at', 'closed_at',
        'archived', 'archived_at', 'rank',
    ];

    public static function isValid(string $key): bool
    {
        return preg_match(self::PATTERN, $key) === 1;
    }

    public static function isCore(string $key): bool
    {
        return in_array($key, self::CORE, true);
    }
}
