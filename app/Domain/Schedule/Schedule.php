<?php

namespace App\Domain\Schedule;

use App\Domain\Filter\InvalidInput;
use App\Domain\WorkItems\DateRange;

/**
 * The schedule of a template (spec 4.12, port of `Schedule` of the clickdummy): every `interval` days, weeks, months
 * or years from `startsOn`, at the wall-clock time `time` in the zone of the organisation, until `ends`.
 *
 * `parse` checks input strictly and throws `InvalidInput` with every wrong path at once, paths relative to the
 * schedule. Codes: `shape` (at `''`: no object or a key it does not know; at `paused`: no switch); at every other field
 * the name of the field (`frequency`, `interval`, `weekdays`, `month_day`, `nth_weekday`, `yearly_date`, `time`,
 * `starts_on`, `ends`); `range` (at `starts_on` and `ends`: a day before 2000 or after 2099, K4). Fields the frequency
 * does not use are dropped unread: weekly reads `weekdays`, monthly `nth_weekday` (it wins) or `month_day`, yearly
 * `yearly_date`. `read` takes a stored schedule and gives null when it cannot read it.
 *
 * Weekdays are 0 = Sunday … 6 = Saturday; an empty list means the weekday of `startsOn`. Without a day of the month or a
 * yearly date the day (and month) of `startsOn` counts.
 */
final readonly class Schedule
{
    public const MAX_INTERVAL = 999;

    public const MAX_COUNT = 9999;

    /** The first and the last day a schedule may start or end on (K4: the columns end in 2038 otherwise). */
    public const FIRST_DAY = '2000-01-01';

    public const LAST_DAY = '2099-12-31';

    /** The n of an n-th weekday: the first to the fourth, -1 the last. */
    public const NTH = [1, 2, 3, 4, -1];

    private const KEYS = ['frequency', 'interval', 'weekdays', 'month_day', 'nth_weekday', 'yearly_date', 'time', 'starts_on', 'ends', 'paused'];

    private const YEARLY_DATE = '/^(\d{2})-(\d{2})\z/';

    /**
     * @param  list<int>  $weekdays  0 = Sunday … 6, sorted, each once
     * @param  int|'last'|null  $monthDay
     * @param  ?array{n: int, weekday: int}  $nthWeekday
     * @param  ?string  $yearlyDate  `MM-DD`
     * @param  string  $time  `HH:MM`
     * @param  string  $startsOn  `YYYY-MM-DD`
     */
    public function __construct(
        public Frequency $frequency,
        public int $interval,
        public array $weekdays,
        public int|string|null $monthDay,
        public ?array $nthWeekday,
        public ?string $yearlyDate,
        public string $time,
        public string $startsOn,
        public ScheduleEnd $ends,
        public bool $paused,
    ) {}

    /**
     * @throws InvalidInput
     */
    public static function parse(mixed $raw): self
    {
        if (! is_array($raw) || ($raw !== [] && array_is_list($raw)) || array_diff(array_keys($raw), self::KEYS) !== []) {
            throw new InvalidInput(['' => 'shape']);
        }

        $errors = [];

        $frequency = is_string($raw['frequency'] ?? null) ? Frequency::tryFrom($raw['frequency']) : null;
        if ($frequency === null) {
            $errors['frequency'] = 'frequency';
        }

        $interval = $raw['interval'] ?? null;
        if (! is_int($interval) || $interval < 1 || $interval > self::MAX_INTERVAL) {
            $errors['interval'] = 'interval';
        }

        $weekdays = [];
        $monthDay = null;
        $nthWeekday = null;
        $yearlyDate = null;
        if ($frequency === Frequency::Weekly) {
            $weekdays = self::weekdays($raw['weekdays'] ?? []);
            if ($weekdays === null) {
                $errors['weekdays'] = 'weekdays';
            }
        } elseif ($frequency === Frequency::Monthly && ($raw['nth_weekday'] ?? null) !== null) {
            $nthWeekday = self::nthWeekday($raw['nth_weekday']);
            if ($nthWeekday === null) {
                $errors['nth_weekday'] = 'nth_weekday';
            }
        } elseif ($frequency === Frequency::Monthly) {
            $monthDay = self::monthDay($raw['month_day'] ?? null);
            if ($monthDay === false) {
                $errors['month_day'] = 'month_day';
            }
        } elseif ($frequency === Frequency::Yearly) {
            $yearlyDate = self::yearlyDate($raw['yearly_date'] ?? null);
            if ($yearlyDate === false) {
                $errors['yearly_date'] = 'yearly_date';
            }
        }

        $time = $raw['time'] ?? null;
        if (! is_string($time) || preg_match(WallClock::TIME, $time) !== 1) {
            $errors['time'] = 'time';
        }

        $startsOn = $raw['starts_on'] ?? null;
        if (! is_string($startsOn) || ! DateRange::isDay($startsOn)) {
            $errors['starts_on'] = 'starts_on';
        } elseif (! self::inRange($startsOn)) {
            $errors['starts_on'] = 'range';
        }

        $ends = self::ends($raw['ends'] ?? null, isset($errors['starts_on']) ? null : $startsOn);
        if (is_string($ends)) {
            $errors['ends'] = $ends;
        }

        $paused = $raw['paused'] ?? false;
        if (! is_bool($paused)) {
            $errors['paused'] = 'shape';
        }

        if ($errors !== [] || ! is_int($interval) || $weekdays === null || $monthDay === false || $yearlyDate === false || ! is_string($time) || ! is_string($startsOn) || ! $ends instanceof ScheduleEnd || ! is_bool($paused)) {
            throw new InvalidInput($errors);
        }

        return new self($frequency, $interval, $weekdays, $monthDay, $nthWeekday, $yearlyDate, $time, $startsOn, $ends, $paused);
    }

    /**
     * A stored schedule, or null when it cannot be read (any more); keys the schema does not know are left out.
     *
     * @param  array<mixed>  $stored
     */
    public static function read(array $stored): ?self
    {
        try {
            return self::parse(array_intersect_key($stored, array_flip(self::KEYS)));
        } catch (InvalidInput) {
            return null;
        }
    }

    /**
     * The normal form, the keys in a fixed order and only the fields the frequency uses (`parse` reads it back as it
     * was).
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $fields = match ($this->frequency) {
            Frequency::Daily => [],
            Frequency::Weekly => ['weekdays' => $this->weekdays],
            Frequency::Monthly => $this->nthWeekday !== null
                ? ['nth_weekday' => ['n' => $this->nthWeekday['n'], 'weekday' => $this->nthWeekday['weekday']]]
                : ($this->monthDay !== null ? ['month_day' => $this->monthDay] : []),
            Frequency::Yearly => $this->yearlyDate !== null ? ['yearly_date' => $this->yearlyDate] : [],
        };

        return [
            'frequency' => $this->frequency->value,
            'interval' => $this->interval,
            ...$fields,
            'time' => $this->time,
            'starts_on' => $this->startsOn,
            'ends' => $this->ends->toArray(),
            'paused' => $this->paused,
        ];
    }

    /**
     * The weekdays sorted and each once, or null when the value is no list of days 0 to 6.
     *
     * @return ?list<int>
     */
    private static function weekdays(mixed $value): ?array
    {
        if (! is_array($value) || ! array_is_list($value)) {
            return null;
        }
        foreach ($value as $day) {
            if (! is_int($day) || $day < 0 || $day > 6) {
                return null;
            }
        }
        $days = array_values(array_unique($value));
        sort($days);

        return $days;
    }

    /**
     * @return ?array{n: int, weekday: int}
     */
    private static function nthWeekday(mixed $value): ?array
    {
        if (! is_array($value) || count($value) !== 2 || ! array_key_exists('n', $value) || ! array_key_exists('weekday', $value)) {
            return null;
        }
        $n = $value['n'];
        $weekday = $value['weekday'];
        if (! is_int($n) || ! in_array($n, self::NTH, true) || ! is_int($weekday) || $weekday < 0 || $weekday > 6) {
            return null;
        }

        return ['n' => $n, 'weekday' => $weekday];
    }

    /**
     * The day of a monthly schedule: null for none (the day of the start), false when it is not 1 to 31 or `last`.
     *
     * @return int|'last'|null|false
     */
    private static function monthDay(mixed $value): int|string|null|false
    {
        return match (true) {
            $value === null => null,
            $value === 'last' => 'last',
            is_int($value) && $value >= 1 && $value <= 31 => $value,
            default => false,
        };
    }

    /**
     * The date of a yearly schedule: null for none (the date of the start), false when it is no `MM-DD` some year
     * has (02-29 is one, 02-30 and 04-31 are not).
     */
    private static function yearlyDate(mixed $value): string|null|false
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || preg_match(self::YEARLY_DATE, $value, $parts) !== 1) {
            return false;
        }

        // 2028 is a leap year: every day some year has exists in it
        return checkdate((int) $parts[1], (int) $parts[2], 2028) ? $value : false;
    }

    /**
     * The end, or the code of what is wrong with it. `$startsOn` is the start day, null when that is wrong itself.
     */
    private static function ends(mixed $value, ?string $startsOn): ScheduleEnd|string
    {
        if (! is_array($value) || array_diff(array_keys($value), ['type', 'date', 'count']) !== []) {
            return 'ends';
        }

        $type = $value['type'] ?? null;
        $date = $value['date'] ?? null;
        $count = $value['count'] ?? null;

        return match ($type) {
            'never' => new ScheduleEnd('never'),
            'on' => match (true) {
                ! is_string($date) || ! DateRange::isDay($date) => 'ends',
                ! self::inRange($date) => 'range',
                $startsOn !== null && strcmp($date, $startsOn) < 0 => 'ends',
                default => new ScheduleEnd('on', $date),
            },
            'count' => is_int($count) && $count >= 1 && $count <= self::MAX_COUNT ? new ScheduleEnd('count', count: $count) : 'ends',
            default => 'ends',
        };
    }

    private static function inRange(string $day): bool
    {
        return strcmp($day, self::FIRST_DAY) >= 0 && strcmp($day, self::LAST_DAY) <= 0;
    }
}
