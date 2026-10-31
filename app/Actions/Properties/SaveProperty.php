<?php

namespace App\Actions\Properties;

use App\Access\Authorize;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\PropertyInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a property or replaces one as a whole (P4, P24): key, label, field type, help text, settings, the options of a
 * dropdown and the default value (org admins). New options come with ids of the client and get ULIDs, the default value
 * is translated (P3); the options it is no longer sent are deleted (Phase 4 archives the ones items use, P5). Runs under
 * the catalog lock, so the key is checked against what the change before left. Only what really changes is written and
 * recorded; the same input again writes nothing.
 */
final class SaveProperty
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `key`, `label`, `field_type`, `help`, `settings`, `options`, `default_value`
     *
     * @throws ValidationException
     * @throws Problem 404 for a property deleted meanwhile
     */
    public function handle(Actor $actor, ?Property $property, array $input): Property
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Properties);

        $input = PropertyInput::normalize($input);

        return DB::transaction(function () use ($actor, $property, $input): Property {
            CatalogLock::take();

            $current = $property === null
                ? null
                : Property::query()->with('options')->find($property->id) ?? throw Problem::notFound();

            $valid = PropertyInput::validate($input, $current);
            $before = $current === null ? null : self::snapshot($current);

            $saved = $current ?? new Property;
            $saved->fill([
                'key' => $valid['key'],
                'label' => $valid['label'],
                'field_type' => $valid['field_type'],
                'help' => $valid['help'],
                'settings' => $valid['settings'],
            ]);

            if (! $saved->exists) {
                $saved->save();
            }

            // the options: the own ones are changed in place, every other one is a new row; key → ULID
            $rows = $current === null ? [] : $current->options->keyBy('id')->all();
            $ids = [];

            foreach ($valid['options'] as $position => $option) {
                $row = $option['existing'] === null ? new PropertyOption(['property_id' => $saved->id]) : $rows[$option['existing']];
                $row->fill([
                    'label' => $option['label'],
                    'color' => $option['color'],
                    'position' => $position,
                    'archived_at' => CatalogInput::archivedStamp($row->archived_at, $option['archived']),
                ])->save();
                $ids[$option['key']] = $row->id;
            }

            $removed = array_values(array_diff(array_keys($rows), array_column($valid['options'], 'existing')));

            if ($removed !== []) {
                PropertyOption::query()->whereKey($removed)->delete();
            }

            $default = $valid['default_value'];
            $saved->default_value = match (true) {
                $ids === [] || $default === null => $default,
                is_array($default) => array_map(fn (string $key) => $ids[$key], $default),
                default => $ids[$default],
            };
            $saved->save();

            // the options as they are now, not as they were read before the writes
            $saved->load('options');

            if ($before === null) {
                EventRecorder::record(EventType::PropertyCreated, $actor, $saved, null, [
                    'key' => ['old' => null, 'new' => $saved->key],
                    'label' => ['old' => null, 'new' => $saved->label],
                ]);

                return $saved;
            }

            $changes = CatalogInput::changes($before, self::snapshot($saved));

            if ($changes !== []) {
                if (! $saved->wasChanged()) {
                    // only options changed: the property changed all the same
                    $saved->touch();
                }

                EventRecorder::record(EventType::PropertyUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /**
     * What an event compares: the fields that can change and the options in order.
     *
     * @return array{label: string, help: string, default_value: mixed, settings: array<string, mixed>, options: list<array{id: string, label: string, color: string, archived: bool}>}
     */
    private static function snapshot(Property $property): array
    {
        return [
            'label' => $property->label,
            'help' => $property->help,
            'default_value' => $property->default_value,
            'settings' => $property->settings,
            'options' => array_values($property->options->map(fn (PropertyOption $option) => [
                'id' => $option->id,
                'label' => $option->label,
                'color' => $option->color->value,
                'archived' => $option->archived_at !== null,
            ])->all()),
        ];
    }
}
