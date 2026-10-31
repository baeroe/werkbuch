<?php

namespace App\Support;

use App\Domain\Catalog\Tone;
use App\Domain\Catalog\TypeIcon;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Property;
use App\Models\WorkItemType;
use Closure;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * The rules, field messages (P9) and the shape of a work item type as a client sends it (spec 4.6, `saveWorkItemType`
 * of the clickdummy): name, icon, tone, description, the epic mark, the properties it asks for in order and the archive
 * stamp, and the rule that keeps the default type of a project (P11). Writes nothing.
 */
final class TypeInput
{
    /**
     * The input with its texts trimmed and the ids of the properties in lower case.
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function normalize(array $input): array
    {
        $input = CatalogInput::trim($input, ['name', 'icon', 'description']);

        if (is_array($input['properties'] ?? null)) {
            foreach ($input['properties'] as $index => $property) {
                if (is_array($property) && array_key_exists('property_id', $property)) {
                    $input['properties'][$index]['property_id'] = Ids::normalize($property['property_id']);
                }
            }
        }

        return $input;
    }

    /**
     * The type as it is to be saved, its properties in the order they were sent.
     *
     * @param  array<array-key, mixed>  $input
     * @return array{name: string, icon: string, tone: Tone, description: string, is_epic: bool, properties: list<array{property_id: string, required: bool}>, archived: bool}
     *
     * @throws ValidationException
     */
    public static function validate(array $input, ?WorkItemType $existing): array
    {
        /** @var array{name: string, icon: string, tone: string, description?: ?string, is_epic: bool|int|string, properties: array<array-key, array{property_id: string, required: bool|int|string}>, archived_at?: ?string} $valid */
        $valid = Validator::make($input, [
            'name' => CatalogInput::name('work_item_types', $existing),
            'icon' => [
                'required',
                function (string $attribute, mixed $value, Closure $fail): void {
                    if (! is_string($value) || ! TypeIcon::isKnown($value)) {
                        $fail(__('field.icon.unknown'));
                    }
                },
            ],
            'tone' => CatalogInput::tone(),
            'description' => CatalogInput::description(),
            'is_epic' => ['required', 'boolean'],
            'properties' => ['present', 'array'],
            'properties.*' => ['array'],
            'properties.*.property_id' => ['required', 'string'],
            'properties.*.required' => ['required', 'boolean'],
            'archived_at' => CatalogInput::archivedAt(),
        ], self::messages())->validate();

        $properties = [];

        // in the order they were sent: `validated()` would put an entry missing a field behind the others
        foreach (array_keys($input['properties']) as $index) {
            $property = $valid['properties'][$index];
            $properties[] = ['property_id' => $property['property_id'], 'required' => (bool) $property['required']];
        }

        $ids = array_column($properties, 'property_id');

        if (count(array_unique($ids)) !== count($ids)) {
            throw ValidationException::withMessages(['properties' => __('field.properties.duplicate')]);
        }

        if (Property::query()->whereKey($ids)->count() !== count($ids)) {
            throw ValidationException::withMessages(['properties' => __('field.properties.unknown')]);
        }

        return [
            'name' => $valid['name'],
            'icon' => $valid['icon'],
            'tone' => Tone::from($valid['tone']),
            'description' => $valid['description'] ?? '',
            'is_epic' => (bool) $valid['is_epic'],
            'properties' => $properties,
            'archived' => ($valid['archived_at'] ?? null) !== null,
        ];
    }

    /**
     * New items need a default type that takes them: the default type of a project is neither archived nor deleted
     * (P11). Archived projects and projects being deleted count too.
     *
     * @throws Problem 409 `default_type` with the identifiers of the projects
     */
    public static function refuseDefaultType(WorkItemType $type): void
    {
        $projects = Project::query()->where('default_type_id', $type->id)->orderBy('name')->orderBy('id')->pluck('identifier')->all();

        if ($projects !== []) {
            throw Problem::conflict('default_type', ['projects' => $projects], __('problem.detail.default_type', ['projects' => implode(', ', $projects)]));
        }
    }

    /**
     * @return array<string, string>
     */
    private static function messages(): array
    {
        return [
            ...CatalogInput::messages(),
            ...CatalogInput::required(['icon', 'tone', 'is_epic', 'properties', 'properties.*.required']),
            'is_epic.boolean' => __('field.boolean'),
            'properties.array' => __('field.properties.unknown'),
            'properties.*.array' => __('field.properties.unknown'),
            'properties.*.property_id.required' => __('field.properties.unknown'),
            'properties.*.property_id.string' => __('field.properties.unknown'),
            'properties.*.required.boolean' => __('field.boolean'),
        ];
    }
}
