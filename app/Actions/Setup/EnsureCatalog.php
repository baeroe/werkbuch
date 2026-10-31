<?php

namespace App\Actions\Setup;

use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Models\Organization;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItemType;
use App\Support\Actor;
use App\Support\CatalogLock;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Makes sure the shipped catalog exists: the default workflow (spec 4.5), Task, Bug and Epic (4.6, R6), the four
 * resolutions and the three built-in relation types (4.8, 4.9). Runs from the migration, creates only what is missing
 * (a workflow, the types, the resolutions, each built-in relation type) and names it in the language of the
 * organization. Every entry it creates is one event of the default bot.
 */
final class EnsureCatalog
{
    use AsAction;

    /** The states of the default workflow, in order: name, icon, category. The names are English in both languages. */
    private const STATES = [
        ['Backlog', StateIcon::Dashed, StateCategory::Backlog],
        ['Todo', StateIcon::Circle, StateCategory::Unstarted],
        ['In Progress', StateIcon::Half, StateCategory::Started],
        ['Pending', StateIcon::Pause, StateCategory::Started],
        ['Done', StateIcon::Check, StateCategory::Completed],
        ['Cancelled', StateIcon::Cross, StateCategory::Canceled],
    ];

    /** The resolutions, in order: label, the category it is the default for. */
    private const RESOLUTIONS = [
        ['Done', StateCategory::Completed],
        ["Won't do", StateCategory::Canceled],
        ['Duplicate', null],
        ['Cannot reproduce', null],
    ];

    private Actor $actor;

    private string $locale;

    public function handle(): void
    {
        DB::transaction(function (): void {
            CatalogLock::take();

            $this->actor = Actor::system(User::defaultBot(), 'setup');
            $this->locale = Organization::current()->locale->value;

            $this->ensureWorkflow();
            $this->ensureTypes();
            $this->ensureResolutions();
            $this->ensureRelationTypes();
        });
    }

    private function ensureWorkflow(): void
    {
        if (Workflow::query()->exists()) {
            return;
        }

        $workflow = Workflow::query()->create([
            'name' => $this->text('catalog.builtin.workflow.name'),
            'description' => $this->text('catalog.builtin.workflow.description'),
            'is_default' => true,
            'is_free' => true,
        ]);

        $states = [];

        foreach (self::STATES as $position => [$name, $icon, $category]) {
            $states[] = WorkflowState::query()->create([
                'workflow_id' => $workflow->id,
                'name' => $name,
                'icon' => $icon,
                'category' => $category,
                'position' => $position,
            ]);
        }

        $workflow->update(['initial_state_id' => $states[0]->id]);
        $this->record(EventType::WorkflowCreated, $workflow, 'name');
    }

    private function ensureTypes(): void
    {
        if (WorkItemType::query()->exists()) {
            return;
        }

        $effort = $this->ensureEffort();

        $types = [
            ['Task', 'square-check', Tone::Sky, false, $this->text('catalog.builtin.type.task.description')],
            ['Bug', 'bug', Tone::Ochre, false, $this->text('catalog.builtin.type.bug.description')],
            ['Epic', 'zap', Tone::Moss, true, $this->text('catalog.builtin.type.epic.description')],
        ];

        foreach ($types as [$name, $icon, $tone, $isEpic, $description]) {
            $type = WorkItemType::query()->create([
                'name' => $name,
                'icon' => $icon,
                'tone' => $tone,
                'description' => $description,
                'is_epic' => $isEpic,
            ]);

            if ($name === 'Bug') {
                TypeProperty::query()->create(['type_id' => $type->id, 'property_id' => $effort->id, 'required' => false, 'position' => 0]);
            }

            $this->record(EventType::WorkItemTypeCreated, $type, 'name');
        }
    }

    /**
     * The optional „Aufwand (h)“ of Bug (R6); a property that already has the key `effort` is used as it is.
     */
    private function ensureEffort(): Property
    {
        $existing = Property::query()->where('key', 'effort')->first();

        if ($existing !== null) {
            return $existing;
        }

        $property = Property::query()->create([
            'key' => 'effort',
            'label' => $this->text('catalog.builtin.property.effort.label'),
            'field_type' => FieldType::Number,
            'help' => $this->text('catalog.builtin.property.effort.help'),
            'default_value' => null,
            'settings' => ['decimals' => 1],
        ]);
        $this->record(EventType::PropertyCreated, $property, 'label');

        return $property;
    }

    private function ensureResolutions(): void
    {
        if (Resolution::query()->exists()) {
            return;
        }

        foreach (self::RESOLUTIONS as $position => [$label, $defaultFor]) {
            $resolution = Resolution::query()->create([
                'label' => $label,
                'default_for' => $defaultFor?->value,
                'position' => $position,
            ]);
            $this->record(EventType::ResolutionCreated, $resolution, 'label');
        }
    }

    private function ensureRelationTypes(): void
    {
        $relationTypes = [
            'blocks' => [
                $this->text('catalog.builtin.relation.blocks.name'),
                $this->text('catalog.builtin.relation.blocks.outward'),
                $this->text('catalog.builtin.relation.blocks.inward'),
            ],
            'duplicates' => [
                $this->text('catalog.builtin.relation.duplicates.name'),
                $this->text('catalog.builtin.relation.duplicates.outward'),
                $this->text('catalog.builtin.relation.duplicates.inward'),
            ],
            'relates' => [
                $this->text('catalog.builtin.relation.relates.name'),
                $this->text('catalog.builtin.relation.relates.outward'),
                null, // symmetric
            ],
        ];

        foreach ($relationTypes as $kind => [$name, $outward, $inward]) {
            if (RelationType::query()->where('built_in', $kind)->exists()) {
                continue;
            }

            $relationType = RelationType::query()->create([
                'name' => $name,
                'outward_label' => $outward,
                'inward_label' => $inward,
                'built_in' => $kind,
            ]);
            $this->record(EventType::RelationTypeCreated, $relationType, 'name');
        }
    }

    private function text(string $key): string
    {
        return __($key, [], $this->locale);
    }

    private function record(EventType $type, Model $subject, string $field): void
    {
        EventRecorder::record($type, $this->actor, $subject, null, [$field => ['old' => null, 'new' => $subject->getAttribute($field)]]);
    }
}
