<?php

namespace App\Domain\Filter;

use App\Domain\Properties\ItemValue;
use App\Domain\Ulid;
use App\Domain\Workflow\StateCategory;
use App\Domain\WorkItems\DateRange;
use App\Domain\WorkItems\Priority;

/**
 * The schema of a filter, `{version: 1, conditions: [{field, op, value?}]}` (plan, table "Filter-Schema"): `parse`
 * checks input strictly and gives its normal form, `read` reads a stored filter without ever refusing it.
 *
 * Codes, at paths relative to the filter: `shape` (no object, `version` not 1, `conditions` no list, a key it does not
 * know; at `''` or `conditions.<n>`), `too_many` (at `conditions`), `field` (no text, no core field, no property of the
 * catalog), `operator` (no operator, or one the field does not offer), `value` (a value of the wrong form, or one for
 * an operator without a value).
 *
 * Values: ULIDs in small letters (`me` where the field takes it), the words of `StateCategory` and `Priority`, days
 * `YYYY-MM-DD` or `today`, `this_week`, `this_month`, `{relative: '±N(d|w)'}`, `true`/`false`, a text of 1–255
 * characters that is not blank, a finite number below `ItemValue::NUMBER_LIMIT` in amount. `is`/`is_not` on an id,
 * enum or list field take one value or a list, `in`/`not_in` a list of 1–100 (doubles are dropped, the order stays),
 * `between` two values, kept as sent (equal ends included).
 */
final class FilterSchema
{
    public const MAX_CONDITIONS = 50;

    public const MAX_VALUES = 100;

    public const TEXT_MAX = 255;

    /** Days or weeks from today: `+7d`, `-2w`, `0d`. */
    public const RELATIVE = '/^([+-]?)(\d{1,5})([dw])\z/';

    /** The dynamic values that stand for days. */
    private const DAY_WORDS = ['today', 'this_week', 'this_month'];

    /**
     * @throws InvalidInput
     */
    public static function parse(mixed $json, PropertyCatalog $catalog): Filter
    {
        $conditions = self::conditionsOf($json);
        if ($conditions === null) {
            throw new InvalidInput(['' => 'shape']);
        }
        if (count($conditions) > self::MAX_CONDITIONS) {
            throw new InvalidInput(['conditions' => 'too_many']);
        }

        $parsed = [];
        $errors = [];
        foreach ($conditions as $index => $raw) {
            $condition = self::condition($raw, $catalog);
            if ($condition instanceof Condition) {
                $parsed[] = $condition;

                continue;
            }
            [$path, $code] = $condition;
            $errors[rtrim("conditions.{$index}.{$path}", '.')] = $code;
        }

        if ($errors !== []) {
            throw new InvalidInput($errors);
        }

        return new Filter($parsed);
    }

    /**
     * A stored filter. A condition that does not fit the schema (any more), because its property is gone or for any
     * other reason, matches nothing (`resolved` is `null`); so does a filter of another form as a whole.
     *
     * @param  array<mixed>  $stored
     */
    public static function read(array $stored, PropertyCatalog $catalog): Filter
    {
        $conditions = self::conditionsOf($stored);
        if ($conditions === null) {
            return new Filter([new Condition('', Op::Is, null, null)]);
        }

        return new Filter(array_map(function (mixed $raw) use ($catalog): Condition {
            $condition = self::condition($raw, $catalog);
            if ($condition instanceof Condition) {
                return $condition;
            }

            $field = is_array($raw) && is_string($raw['field'] ?? null) ? $raw['field'] : '';
            $op = is_array($raw) && is_string($raw['op'] ?? null) ? Op::tryFrom($raw['op']) : null;

            return new Condition($field, $op ?? Op::Is, is_array($raw) ? ($raw['value'] ?? null) : null, null);
        }, $conditions));
    }

    /**
     * The conditions of a filter of the right form; `null` for any other.
     *
     * @return list<mixed>|null
     */
    private static function conditionsOf(mixed $json): ?array
    {
        if (! is_array($json) || array_diff(array_keys($json), ['version', 'conditions']) !== []) {
            return null;
        }
        $conditions = $json['conditions'] ?? null;

        return ($json['version'] ?? null) === 1 && is_array($conditions) && array_is_list($conditions) ? $conditions : null;
    }

    /**
     * One condition in its normal form, or what is wrong with it: the path below the condition and the code.
     *
     * @return Condition|array{0: string, 1: string}
     */
    private static function condition(mixed $raw, PropertyCatalog $catalog): Condition|array
    {
        if (! is_array($raw) || array_diff(array_keys($raw), ['field', 'op', 'value']) !== []) {
            return ['', 'shape'];
        }

        $field = is_string($raw['field'] ?? null) ? Field::named($raw['field'], $catalog) : null;
        if ($field === null) {
            return ['field', 'field'];
        }

        $op = is_string($raw['op'] ?? null) ? Op::tryFrom($raw['op']) : null;
        if ($op === null || ! in_array($op, $field->ops(), true)) {
            return ['op', 'operator'];
        }

        $value = self::value($field, $op, $raw['value'] ?? null);

        return $value === null ? ['value', 'value'] : new Condition($field->name, $op, $value[0], $field);
    }

    /**
     * The value in its normal form, wrapped in a list of one; `null` when it does not fit field and operator.
     *
     * @return array{0: mixed}|null
     */
    private static function value(Field $field, Op $op, mixed $value): ?array
    {
        if (! $op->takesValue()) {
            return $value === null ? [null] : null;
        }

        $choice = in_array($field->kind, [FieldKind::Id, FieldKind::Enum, FieldKind::List], true);
        $isList = is_array($value) && array_is_list($value);

        return match (true) {
            $op === Op::Between => $isList && count($value) === 2 ? self::range($field, $value[0], $value[1]) : null,
            $op === Op::In, $op === Op::NotIn => $isList ? self::values($field, $value) : null,
            $choice && $isList => self::values($field, $value),
            default => self::single($field, $value),
        };
    }

    /**
     * Both ends of a `between`, each of the right form, kept as sent: equal ends are a range of one day or one number.
     *
     * @return array{0: array{0: mixed, 1: mixed}}|null
     */
    private static function range(Field $field, mixed $from, mixed $to): ?array
    {
        $low = self::single($field, $from);
        $high = self::single($field, $to);

        return $low === null || $high === null ? null : [[$low[0], $high[0]]];
    }

    /**
     * A list of 1–100 values, each of the right form, without doubles in the order sent.
     *
     * @param  list<mixed>  $values
     * @return array{0: list<mixed>}|null
     */
    private static function values(Field $field, array $values): ?array
    {
        if ($values === [] || count($values) > self::MAX_VALUES) {
            return null;
        }

        $normal = [];
        foreach ($values as $value) {
            $one = self::single($field, $value);
            if ($one === null) {
                return null;
            }
            if (! in_array($one[0], $normal, true)) {
                $normal[] = $one[0];
            }
        }

        return [$normal];
    }

    /**
     * One value of the right form for the field.
     *
     * @return array{0: mixed}|null
     */
    private static function single(Field $field, mixed $value): ?array
    {
        $normal = match ($field->kind) {
            FieldKind::Id, FieldKind::List => self::id($field, $value),
            FieldKind::Enum => self::word($field, $value),
            FieldKind::Date, FieldKind::Stamp => self::day($value),
            FieldKind::Flag => is_bool($value) ? $value : null,
            FieldKind::Text, FieldKind::Rich => is_string($value) && trim($value) !== '' && mb_strlen($value) <= self::TEXT_MAX ? $value : null,
            FieldKind::Number => (is_int($value) || is_float($value)) && is_finite($value) && abs($value) < ItemValue::NUMBER_LIMIT ? $value : null,
        };

        return $normal === null ? null : [$normal];
    }

    private static function id(Field $field, mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        if ($value === 'me') {
            return $field->acceptsMe ? 'me' : null;
        }

        $id = strtolower($value);

        return preg_match(Ulid::PATTERN, $id) === 1 ? $id : null;
    }

    /** A word of the state categories or the priorities, exactly as the enum spells it. */
    private static function word(Field $field, mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $known = $field->name === CoreField::StateCategory->value ? StateCategory::tryFrom($value) : Priority::tryFrom($value);

        return $known?->value;
    }

    /**
     * A day, a dynamic day or `{relative: '±N(d|w)'}`.
     *
     * @return string|array{relative: string}|null
     */
    private static function day(mixed $value): string|array|null
    {
        if (is_string($value)) {
            return DateRange::isDay($value) || in_array($value, self::DAY_WORDS, true) ? $value : null;
        }

        $relative = is_array($value) && array_keys($value) === ['relative'] ? $value['relative'] : null;

        return is_string($relative) && preg_match(self::RELATIVE, $relative) === 1 ? ['relative' => $relative] : null;
    }
}
