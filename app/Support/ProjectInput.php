<?php

namespace App\Support;

use App\Domain\Projects\Identifier;
use App\Enums\AccountType;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use Closure;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

/**
 * The rules and field messages (P9) of a project's fields that CreateProject and UpdateProject share (spec 4.4, the
 * rules of src/api/projects.ts).
 */
final class ProjectInput
{
    public const NAME_MAX = 120;

    public const DESCRIPTION_MAX = 2000;

    /**
     * The input with its texts trimmed and the identifier the way it is stored.
     *
     * @param  array<array-key, mixed>  $input
     * @return array<array-key, mixed>
     */
    public static function normalize(array $input): array
    {
        foreach (['name', 'description'] as $field) {
            if (is_string($input[$field] ?? null)) {
                $input[$field] = trim($input[$field]);
            }
        }

        if (is_string($input['identifier'] ?? null)) {
            $input['identifier'] = Identifier::normalize($input['identifier']);
        }

        return $input;
    }

    /**
     * A valid identifier that no project holds, neither now nor as a former one: former identifiers keep resolving, so
     * they are never handed out again. `$own` may keep its identifier and come back to one of its former ones. Whoever
     * may not see the project holding it learns only that it is taken.
     *
     * @return list<mixed>
     */
    public static function identifier(?Project $own = null): array
    {
        $former = Rule::unique('project_identifiers', 'identifier');

        if ($own !== null) {
            $former->whereNot('project_id', $own->id);
        }

        return [
            'bail', 'required', 'string',
            function (string $attribute, string $value, Closure $fail): void {
                if (! Identifier::isValid($value)) {
                    $fail(__('field.identifier.format'));
                }
            },
            Rule::unique('projects', 'identifier')->ignore($own?->id),
            $former,
        ];
    }

    /**
     * @return list<mixed>
     */
    public static function visibility(): array
    {
        return ['required', 'string', Rule::enum(ProjectVisibility::class)];
    }

    /**
     * The lead of a project: an active person (P17); bots get no notifications.
     */
    public static function lead(): Exists
    {
        return Rule::exists('users', 'id')->where('type', AccountType::Person->value)->whereNull('disabled_at');
    }

    /**
     * @return array<string, string>
     */
    public static function messages(): array
    {
        return [
            ...ImageInput::messages('image_url'),
            'name.required' => __('field.name.required'),
            'name.string' => __('field.name.invalid'),
            'name.max' => __('field.name.max'),
            'description.string' => __('field.description.invalid'),
            'description.max' => __('field.description.max'),
            'identifier.required' => __('field.identifier.format'),
            'identifier.string' => __('field.identifier.format'),
            'identifier.unique' => __('field.identifier.taken'),
            'visibility.required' => __('field.visibility.unknown'),
            'visibility.string' => __('field.visibility.unknown'),
            'visibility.enum' => __('field.visibility.unknown'),
            'lead_id.required' => __('field.lead.invalid'),
            'lead_id.string' => __('field.lead.invalid'),
            'lead_id.exists' => __('field.lead.invalid'),
        ];
    }
}
