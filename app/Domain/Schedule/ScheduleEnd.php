<?php

namespace App\Domain\Schedule;

/**
 * When a schedule ends: `never`, `on` a day (the day itself still runs) or after `count` scheduled runs.
 */
final readonly class ScheduleEnd
{
    public const TYPES = ['never', 'on', 'count'];

    /**
     * @param  'never'|'on'|'count'  $type
     * @param  ?string  $date  the last day (`YYYY-MM-DD`) of `on`, otherwise null
     * @param  ?int  $count  the number of runs of `count`, otherwise null
     */
    public function __construct(
        public string $type,
        public ?string $date = null,
        public ?int $count = null,
    ) {}

    /**
     * The normal form: `{type}`, `{type, date}` or `{type, count}`.
     *
     * @return array{type: string, date?: string, count?: int}
     */
    public function toArray(): array
    {
        return match (true) {
            $this->type === 'on' && $this->date !== null => ['type' => 'on', 'date' => $this->date],
            $this->type === 'count' && $this->count !== null => ['type' => 'count', 'count' => $this->count],
            default => ['type' => $this->type],
        };
    }
}
