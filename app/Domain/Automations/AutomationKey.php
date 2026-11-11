<?php

namespace App\Domain\Automations;

/**
 * The five automations of a project (spec 4.16): what each one is called and starts with.
 */
enum AutomationKey: string
{
    case AutoArchive = 'auto_archive';
    case AutoClose = 'auto_close';
    case CloseParent = 'close_parent';
    case AssignOnStart = 'assign_on_start';
    case LinkReferences = 'link_references';

    /** The least and the most days a nightly automation waits. */
    public const MIN_DAYS = 1;

    public const MAX_DAYS = 3650;

    /**
     * The settings a new automation starts with.
     *
     * @return array<string, int|string|null>
     */
    public function defaults(): array
    {
        return match ($this) {
            self::AutoArchive => ['days' => 30],
            self::AutoClose => ['days' => 90, 'state_id' => null],
            self::CloseParent, self::AssignOnStart, self::LinkReferences => [],
        };
    }

    /**
     * Whether a project that never saved this automation has it on (A452). Only link_references starts on; no nightly
     * key may (RunDailyAutomations reads rows only, a key on by default would never run without one).
     */
    public function enabledByDefault(): bool
    {
        return $this === self::LinkReferences;
    }

    /** Whether the automation runs every night (03:00 in the time zone of the organisation) instead of on an event. */
    public function daily(): bool
    {
        return $this === self::AutoArchive || $this === self::AutoClose;
    }
}
