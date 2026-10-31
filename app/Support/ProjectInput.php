<?php

namespace App\Support;

use App\Domain\Projects\Identifier;
use App\Enums\AccountType;
use App\Enums\ProjectVisibility;
use App\Models\Project;
use App\Models\WorkItemType;
use Closure;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\ValidationException;

/**
 * The rules and field messages (P9) of a project's fields that CreateProject, UpdateProject and AssignWorkflow share
 * (spec 4.4, the rules of src/api/projects.ts), with the check of the switched-on types against the catalog.
 */
final class ProjectInput
{
    public const NAME_MAX = 120;

    public const DESCRIPTION_MAX = 2000;

    /**
     * The input with its texts trimmed and the identifier and the IDs the way they are stored.
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

        // ULIDs are stored in lower case; the collation would let an upper-case one pass `exists` as somebody else
        foreach (['lead_id', 'workflow_id', 'enabled_type_ids', 'default_type_id', 'mapping'] as $field) {
            if (array_key_exists($field, $input)) {
                $input[$field] = Ids::normalize($input[$field]);
            }
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
     * A workflow of the catalog.
     *
     * @return list<mixed>
     */
    public static function workflow(): array
    {
        return ['bail', 'required', 'string', Rule::exists('workflows', 'id')];
    }

    /**
     * The switched-on types as a list: at least one, each an ID once. Whether they exist and may be switched on, says
     * `enabledTypes()` under the catalog lock.
     *
     * @return list<mixed>
     */
    public static function types(): array
    {
        return [
            'bail', 'required', 'array', 'list',
            function (string $attribute, array $value, Closure $fail): void {
                if (array_filter($value, fn (mixed $id) => ! is_string($id)) !== []) {
                    $fail(__('field.enabled_type_ids.unknown'));
                } elseif (count(array_unique($value)) !== count($value)) {
                    $fail(__('field.enabled_type_ids.duplicate'));
                }
            },
        ];
    }

    /**
     * The switched-on types in catalog order (by ULID) and the default type, checked against the catalog: every type
     * exists, a type switched on anew is active (one that was on already stays, also archived, P11), and the default
     * type is one of them and active. Without a default the first type is it (P10). Callers hold the catalog lock, so
     * no type is archived or deleted while it is checked.
     *
     * @param  list<string>  $enabled
     * @param  list<string>  $current  the types switched on so far
     * @return array{0: list<string>, 1: string}
     *
     * @throws ValidationException
     */
    public static function enabledTypes(array $enabled, ?string $default, array $current = []): array
    {
        $types = WorkItemType::query()->whereKey($enabled)->orderBy('id')->get(['id', 'archived_at']);

        if ($types->count() !== count($enabled)) {
            throw ValidationException::withMessages(['enabled_type_ids' => __('field.enabled_type_ids.unknown')]);
        }

        if ($types->contains(fn (WorkItemType $type) => $type->archived_at !== null && ! in_array($type->id, $current, true))) {
            throw ValidationException::withMessages(['enabled_type_ids' => __('field.enabled_type_ids.archived')]);
        }

        $ids = array_values($types->map(fn (WorkItemType $type) => $type->id)->all());
        $default ??= $ids[0];
        $type = $types->find($default);

        if ($type === null) {
            throw ValidationException::withMessages(['default_type_id' => __('field.default_type_id.enabled')]);
        }

        if ($type->archived_at !== null) {
            throw ValidationException::withMessages(['default_type_id' => __('field.default_type_id.archived')]);
        }

        return [$ids, $default];
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
            'workflow_id.required' => __('field.required'),
            'workflow_id.string' => __('field.workflow_id.unknown'),
            'workflow_id.exists' => __('field.workflow_id.unknown'),
            'enabled_type_ids.required' => __('field.enabled_type_ids.required'),
            'enabled_type_ids.array' => __('field.enabled_type_ids.unknown'),
            'enabled_type_ids.list' => __('field.enabled_type_ids.unknown'),
            'default_type_id.required' => __('field.default_type_id.enabled'),
            'default_type_id.string' => __('field.default_type_id.enabled'),
            'mapping.array' => __('field.state_mapping.invalid'),
        ];
    }
}
