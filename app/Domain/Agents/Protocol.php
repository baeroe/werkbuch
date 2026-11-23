<?php

namespace App\Domain\Agents;

/**
 * The numbers of the runner protocol (spec 6, A474): its version, the lease of a run, how long a runner may be offline
 * before another one takes over its strand (spec 9, fixed), and how long run events are kept (spec 7.5).
 */
final class Protocol
{
    /** The version a runner has to speak; a runner with an older one gets no runs (spec 6.1). */
    public const VERSION = 1;

    /** A heartbeat extends the lease by this much; the runner sends one about every 15 seconds. */
    public const LEASE_SECONDS = 60;

    /** How often the runner should send a heartbeat (a hint in every answer). */
    public const HEARTBEAT_SECONDS = 15;

    /** After this long offline, another runner of the pool takes over a strand (spec 9). */
    public const TAKEOVER_MINUTES = 30;

    /** A run lost this often ends as `lost`; before, it goes back to the queue (spec 6.4, A475). */
    public const MAX_ATTEMPTS = 2;

    /** Run events: at most this many rows and bytes per run, kept this many days (spec 7.5, A481). */
    public const EVENTS_MAX_ROWS = 2000;

    public const EVENTS_MAX_BYTES = 1_048_576;

    public const EVENTS_KEEP_DAYS = 30;

    /** One batch of events, and one line of it. */
    public const EVENTS_PER_BATCH = 100;

    public const EVENT_TEXT_MAX = 4000;

    /** The minutes past the time limit the run token lives, so the last calls of the agent still reach werkbuch. */
    public const TOKEN_GRACE_MINUTES = 10;
}
