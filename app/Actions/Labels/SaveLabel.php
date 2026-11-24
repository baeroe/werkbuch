<?php

namespace App\Actions\Labels;

use App\Access\Authorize;
use App\Domain\Agents\AgentModel;
use App\Domain\Catalog\Tone;
use App\Enums\Catalog;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a label or replaces one as a whole (P24): a name and a tone (org admins). Runs under the catalog lock, so the
 * name is checked against what the change before left. Only what really changes is written and recorded; the same input
 * again writes nothing. A label has no default (R23).
 */
final class SaveLabel
{
    use AsAction;

    /** The keys of the input the action reads (the OpenAPI document holds its body against them). */
    public const FIELDS = ['name', 'color', 'agent_model'];

    /**
     * @param  array<array-key, mixed>  $input  `name`, `color`, `agent_model` (`cli:model` or `null`, spec 7.7)
     *
     * @throws ValidationException
     * @throws Problem 404 for a label deleted meanwhile
     */
    public function handle(Actor $actor, ?Label $label, array $input): Label
    {
        Authorize::check($actor, 'manageCatalog', Organization::class, Catalog::Labels);

        $input = CatalogInput::trim($input, ['name']);

        return DB::transaction(function () use ($actor, $label, $input): Label {
            CatalogLock::take();

            $current = $label === null ? null : Label::query()->find($label->id) ?? throw Problem::notFound();

            /** @var array{name: string, color: string, agent_model?: ?string} $valid */
            $valid = Validator::make($input, [
                'name' => CatalogInput::name('labels', $current),
                'color' => CatalogInput::tone(),
                'agent_model' => ['nullable', Rule::in(AgentModel::values())],
            ], [
                'agent_model' => __('field.agent_model.invalid', ['allowed' => implode(', ', AgentModel::values())]),
                ...CatalogInput::messages(),
                ...CatalogInput::required(['color']),
            ])->validate();

            $before = $current === null ? null : self::snapshot($current);

            $saved = $current ?? new Label;
            $saved->fill(['name' => $valid['name'], 'color' => Tone::from($valid['color']), // a body without the key keeps the model (A590), `null` clears it
                'agent_model' => array_key_exists('agent_model', $input) ? ($valid['agent_model'] ?? null) : $current?->agent_model])->save();

            if ($before === null) {
                EventRecorder::record(EventType::LabelCreated, $actor, $saved, null, [
                    'name' => ['old' => null, 'new' => $saved->name],
                    'color' => ['old' => null, 'new' => $saved->color->value],
                    ...($saved->agent_model === null ? [] : ['agent_model' => ['old' => null, 'new' => $saved->agent_model]]),
                ]);

                return $saved;
            }

            $changes = CatalogInput::changes($before, self::snapshot($saved));

            if ($changes !== []) {
                EventRecorder::record(EventType::LabelUpdated, $actor, $saved, null, $changes);
            }

            return $saved;
        });
    }

    /**
     * What an event compares.
     *
     * @return array{name: string, color: string, agent_model: ?string}
     */
    private static function snapshot(Label $label): array
    {
        return ['name' => $label->name, 'color' => $label->color->value, 'agent_model' => $label->agent_model];
    }
}
