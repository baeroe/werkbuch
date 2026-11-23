<?php

namespace App\Domain\Agents;

/**
 * The kinds of run (spec 7.1): `task`, `correction` and `conflict` change code, `review` and `comment` only read and
 * come out of the runner's pot of light runs (spec 9).
 */
enum RunType: string
{
    case Task = 'task';
    case Correction = 'correction';
    case Conflict = 'conflict';
    case Review = 'review';
    case Comment = 'comment';

    /** The values in the order of the spec. */
    public const VALUES = ['task', 'correction', 'conflict', 'review', 'comment'];

    /** Whether the run only reads: it counts in the pot of light runs alone, never in all or per repo (spec 9). */
    public function light(): bool
    {
        return $this === self::Review || $this === self::Comment;
    }

    /** The fixed time limit in minutes (spec 6.4): not a setting. */
    public function timeoutMinutes(): int
    {
        return match ($this) {
            self::Task, self::Correction => 60,
            self::Conflict => 30,
            self::Review => 20,
            self::Comment => 10,
        };
    }

    /** Conflicts, corrections and reviews go before tasks and comments (spec 9). */
    public function urgent(): bool
    {
        return $this === self::Conflict || $this === self::Correction || $this === self::Review;
    }

    /**
     * What the run token of the kind may do (spec 11.2): runs that change code read and write, the light ones only read;
     * all reach werkbuch through MCP.
     *
     * @return list<string>
     */
    public function abilities(): array
    {
        return $this->light() ? ['read', 'mcp'] : ['read', 'write', 'mcp'];
    }
}
