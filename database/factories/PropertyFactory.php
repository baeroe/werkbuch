<?php

namespace Database\Factories;

use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Models\Property;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * A text property without options.
 *
 * @extends Factory<Property>
 */
class PropertyFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'key' => fake()->unique()->lexify('prop_????'),
            'label' => fake()->unique()->words(2, true),
            'field_type' => FieldType::Text,
            'help' => '',
            'default_value' => null,
            'settings' => [],
        ];
    }

    /**
     * A dropdown with one option per label, in this order.
     *
     * @param  list<string>  $labels
     */
    public function dropdown(array $labels, bool $multiple = false): static
    {
        return $this->state(['field_type' => FieldType::Dropdown, 'settings' => ['multiple' => $multiple]])
            ->afterCreating(function (Property $property) use ($labels) {
                foreach ($labels as $position => $label) {
                    $property->options()->create(['label' => $label, 'color' => Tone::Sky, 'position' => $position]);
                }
            });
    }
}
