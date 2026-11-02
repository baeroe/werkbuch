<?php

namespace App\Support;

use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Domain\Views\DisplaySchema;

/**
 * The sentences of the codes of the filter, display and sort schemas, at the paths of the caller (K2): the schemas say
 * what is wrong relative to their own root, the callers (ViewInput, ItemQueryInput, Shorthand) say where it stands.
 */
final class SchemaMessages
{
    /**
     * @return array<string, string> path → sentence
     */
    public static function filter(InvalidInput $invalid, string $at): array
    {
        return array_map(fn (string $code): string => match ($code) {
            'too_many' => __('field.filter.too_many', ['max' => FilterSchema::MAX_CONDITIONS]),
            'field' => __('field.filter.field'),
            'operator' => __('field.filter.operator'),
            'value' => __('field.filter.value'),
            default => __('field.filter.shape'),
        }, $invalid->errorsAt($at));
    }

    /**
     * @return array<string, string> path → sentence
     */
    public static function display(InvalidInput $invalid, string $at): array
    {
        return array_map(fn (string $code): string => match ($code) {
            'too_many' => __('field.display.too_many', ['max' => DisplaySchema::MAX_FIELDS]),
            'invalid' => __('field.display.invalid'),
            default => __('field.display.shape'),
        }, $invalid->errorsAt($at));
    }

    /**
     * A sort of a request (`SortSpec::parse`, `fromQuery`) knows only one code.
     *
     * @return array<string, string> path → sentence
     */
    public static function sort(InvalidInput $invalid, string $at): array
    {
        return array_map(fn (): string => __('field.sort.invalid'), $invalid->errorsAt($at));
    }
}
