<?php

namespace App\Support;

use App\Domain\Automations\AutomationKey;
use App\Models\Automation;

/**
 * The automations of a project as they stand (spec 4.13): a key without a row is off with the settings its key starts
 * with (AutomationKey::defaults()), as an unsaved model. Reads without a lock; the callers that write hold the project.
 */
final class ProjectAutomations
{
    /**
     * All four in the order of AutomationKey::cases(), in one query.
     *
     * @return array<string, Automation> key → automation
     */
    public static function of(string $projectId): array
    {
        $stored = Automation::query()->where('project_id', $projectId)->get()->keyBy(fn (Automation $a) => $a->key->value);
        $all = [];

        foreach (AutomationKey::cases() as $key) {
            $all[$key->value] = $stored->get($key->value) ?? self::unsaved($projectId, $key);
        }

        return $all;
    }

    /** The automation of this key when it is switched on, else null. */
    public static function enabled(string $projectId, AutomationKey $key): ?Automation
    {
        return Automation::query()->where('project_id', $projectId)->where('key', $key)->where('enabled', true)->first();
    }

    /** A key without a row: off, with its defaults. */
    public static function unsaved(string $projectId, AutomationKey $key): Automation
    {
        return new Automation(['project_id' => $projectId, 'key' => $key, 'enabled' => false, 'settings' => $key->defaults()]);
    }
}
