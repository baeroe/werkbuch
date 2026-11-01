<?php

namespace App\Views;

use App\Domain\Filter\PropertyCatalog;
use App\Domain\Properties\PropertyShape;
use App\Models\Property;
use Illuminate\Database\Query\JoinClause;

/**
 * The properties of the organisation as filters, sorts and displays look them up, read with one query (each property
 * with its field type, settings and the options that are not archived). AppServiceProvider binds it scoped: once per
 * request and job.
 */
final class CatalogProperties implements PropertyCatalog
{
    /**
     * @param  array<string, PropertyShape>  $shapes  by key
     */
    private function __construct(private readonly array $shapes) {}

    public static function load(): self
    {
        $rows = Property::query()
            ->leftJoin('property_options as options', fn (JoinClause $join) => $join->on('options.property_id', '=', 'properties.id')->whereNull('options.archived_at'))
            ->select('properties.key', 'properties.field_type', 'properties.settings', 'options.id as option_id')
            ->orderBy('properties.key')->orderBy('options.position')->orderBy('options.id')
            ->get();

        $shapes = [];
        foreach ($rows->groupBy('key') as $key => $options) {
            /** @var Property $property */
            $property = $options->first();
            $shapes[(string) $key] = new PropertyShape(
                $property->field_type,
                (int) ($property->settings['decimals'] ?? 0),
                ($property->settings['multiple'] ?? false) === true,
                array_values(array_filter($options->map(fn (Property $row) => $row->getAttribute('option_id'))->all(), 'is_string')),
            );
        }

        return new self($shapes);
    }

    public function shape(string $key): ?PropertyShape
    {
        return $this->shapes[$key] ?? null;
    }
}
