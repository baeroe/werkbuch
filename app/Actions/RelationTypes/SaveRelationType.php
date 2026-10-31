<?php

namespace App\Actions\RelationTypes;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\RelationType;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a relation type or replaces one as a whole (P24): a name and the label of each direction (org admins). Without
 * an `inward_label` (`null`, also when it is missing) the relation is symmetric; an empty one is refused, REST makes it
 * `null` before. `built_in` is never taken from the input: a built-in type stays built in and can be renamed, an own one
 * never becomes built in. Runs under the catalog lock, so the name is checked against what the change before left. Only
 * what really changes is written and recorded.
 */
final class SaveRelationType
{
    use AsAction;

    public const LABEL_MAX = 60;

    /**
     * @param  array<array-key, mixed>  $input  `name`, `outward_label`, `inward_label`
     *
     * @throws ValidationException
     * @throws Problem 404 for a relation type deleted meanwhile
     */
    public function handle(Actor $actor, ?RelationType $type, array $input): RelationType
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::RelationTypes);

        $input = CatalogInput::trim($input, ['name', 'outward_label', 'inward_label']);

        return DB::transaction(function () use ($actor, $type, $input): RelationType {
            CatalogLock::take();

            $current = $type === null ? null : RelationType::query()->find($type->id) ?? throw Problem::notFound();

            /** @var array{name: string, outward_label: string, inward_label?: ?string} $valid */
            $valid = Validator::make($input, [
                'name' => CatalogInput::name('relation_types', $current),
                'outward_label' => ['required', 'string', 'max:'.self::LABEL_MAX],
                'inward_label' => ['nullable', 'string', 'max:'.self::LABEL_MAX],
            ], [
                ...CatalogInput::messages(),
                'outward_label.required' => __('field.outward_label.required'),
                'outward_label.string' => __('field.outward_label.invalid'),
                'outward_label.max' => __('field.outward_label.max'),
                'inward_label.string' => __('field.inward_label.invalid'),
                'inward_label.max' => __('field.inward_label.max'),
            ])->after(function ($validator) use ($input): void {
                // `nullable` lets an empty string pass; the symmetric relation is `null`, not an empty label
                if (($input['inward_label'] ?? null) === '') {
                    $validator->errors()->add('inward_label', __('field.inward_label.required'));
                }
            })->validate();

            $before = $current === null ? null : self::snapshot($current);

            $saved = $current ?? new RelationType;
            $saved->fill([
                'name' => $valid['name'],
                'outward_label' => $valid['outward_label'],
                'inward_label' => $valid['inward_label'] ?? null,
            ])->save();

            if ($before === null) {
                EventRecorder::record(EventType::RelationTypeCreated, $actor, $saved, null, ['name' => ['old' => null, 'new' => $saved->name]]);

                return $saved;
            }

            $changes = CatalogInput::changes($before, self::snapshot($saved));

            if ($changes !== []) {
                EventRecorder::record(EventType::RelationTypeUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /**
     * What an event compares.
     *
     * @return array{name: string, outward_label: string, inward_label: ?string}
     */
    private static function snapshot(RelationType $type): array
    {
        return ['name' => $type->name, 'outward_label' => $type->outward_label, 'inward_label' => $type->inward_label];
    }
}
