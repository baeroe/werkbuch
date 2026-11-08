<?php

namespace Database\Seeders\Demo;

use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Domain\Workflow\StateCategory;
use App\Domain\Workflow\StateIcon;
use App\Models\Label;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\RelationType;
use App\Models\TypeProperty;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkflowTransition;
use App\Models\WorkItemType;
use Database\Seeders\Demo\Texts\DemoTexts;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The catalog of the clickdummy (src/api/seed/config.ts, src/domain/fixtures.ts): the texts of the shipped entries in
 * the language of the demo, the workflow „Agentur-Freigabe“, the properties, the type „Kundenwunsch“, the labels and
 * the relation type „testet“ (DemoTexts, keyed `catalog.*` by the keys below; „Agency approval“, „Client request“ and
 * „tests“ in English). Every entry is found by a stable key (workflow, type and label name in the language of the
 * demo, property key, `built_in` or name of a relation type), so running it again changes nothing. It never moves the mark of the default workflow and never
 * creates „Standard“ (the migration does). It writes the rows directly, like the other demo seeders: the
 * demo data come without events. The shipped resolutions already are the ones of the clickdummy.
 */
class CatalogSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->workflows();
        $properties = $this->properties();
        $this->types($properties);
        $this->labels();
        $this->relationTypes();
    }

    private function workflows(): void
    {
        // the shipped workflow gets its text, if it still has its name; it is never created here: the migration made it
        // with its states, an empty one of that name would be no workflow at all
        Workflow::query()->where('name', DemoTexts::get('catalog.workflow.standard.name'))->first()?->update([
            'description' => DemoTexts::get('catalog.workflow.standard.description'),
        ]);

        // never the default when it is made, and it keeps the mark if an admin gave it one: one default at all times
        $agency = Workflow::query()->firstOrNew(['name' => DemoTexts::get('catalog.workflow.agency.name')], ['is_default' => false]);
        $agency->fill([
            'description' => DemoTexts::get('catalog.workflow.agency.description'),
            'is_free' => false,
        ])->save();

        /** @var array<string, WorkflowState> $states by key */
        $states = [];

        foreach ([
            ['backlog', StateIcon::Dashed, StateCategory::Backlog],
            ['todo', StateIcon::Circle, StateCategory::Unstarted],
            ['progress', StateIcon::Half, StateCategory::Started],
            ['review', StateIcon::ThreeQuarter, StateCategory::Started],
            ['approval', StateIcon::Pause, StateCategory::Started],
            ['done', StateIcon::Check, StateCategory::Completed],
            ['cancelled', StateIcon::Cross, StateCategory::Canceled],
        ] as $position => [$key, $icon, $category]) {
            $states[$key] = WorkflowState::query()->updateOrCreate(
                ['workflow_id' => $agency->id, 'name' => DemoTexts::get("catalog.state.{$key}")],
                ['icon' => $icon, 'category' => $category, 'position' => $position],
            );
        }

        $agency->update(['initial_state_id' => $states['backlog']->id]);

        // only these moves are allowed; every open status can be cancelled, Done and Cancelled reopen
        foreach ([
            ['backlog', 'todo'], ['todo', 'progress'], ['progress', 'review'], ['review', 'progress'],
            ['review', 'approval'], ['approval', 'done'], ['approval', 'progress'],
            ['backlog', 'cancelled'], ['todo', 'cancelled'], ['progress', 'cancelled'], ['review', 'cancelled'], ['approval', 'cancelled'],
            ['done', 'todo'], ['cancelled', 'backlog'],
        ] as [$from, $to]) {
            WorkflowTransition::query()->firstOrCreate([
                'workflow_id' => $agency->id,
                'from_state_id' => $states[$from]->id,
                'to_state_id' => $states[$to]->id,
            ]);
        }
    }

    /**
     * @return array<string, Property> by key
     */
    private function properties(): array
    {
        $properties = [];

        foreach ([
            ['customer', FieldType::Dropdown, [], ['nordlicht' => Tone::Sky, 'hafenkontor' => Tone::Ochre, 'moos' => Tone::Moss], null],
            ['effort', FieldType::Number, ['decimals' => 1], [], null],
            ['environment', FieldType::Dropdown, [], ['prod' => Tone::Plum, 'staging' => Tone::Ochre, 'local' => Tone::Slate], null],
            ['browser', FieldType::Text, [], [], null],
            ['ticket_url', FieldType::Url, [], [], null],
            ['approved', FieldType::Boolean, [], [], false],
            ['reviewer', FieldType::Member, [], [], null],
            ['steps', FieldType::RichText, [], [], null],
            ['target_quarter', FieldType::Dropdown, [], ['q4_2026' => Tone::Sky, 'q1_2027' => Tone::Moss, 'q2_2027' => Tone::Sand], null],
        ] as [$key, $fieldType, $settings, $options, $default]) {
            $property = Property::query()->updateOrCreate(['key' => $key], [
                'label' => DemoTexts::get("catalog.property.{$key}.label"),
                'field_type' => $fieldType,
                'help' => DemoTexts::get("catalog.property.{$key}.help"),
                'settings' => $settings,
                'default_value' => $default,
            ]);
            $position = 0;

            foreach ($options as $option => $color) {
                PropertyOption::query()->updateOrCreate(
                    ['property_id' => $property->id, 'label' => DemoTexts::get("catalog.property.{$key}.option.{$option}")],
                    ['color' => $color, 'position' => $position++, 'archived_at' => null],
                );
            }

            $properties[$key] = $property;
        }

        return $properties;
    }

    /**
     * @param  array<string, Property>  $properties
     */
    private function types(array $properties): void
    {
        // the shipped ones keep their order (their ids); a new one comes after them
        foreach ([
            ['task', 'square-check', Tone::Sky, false, ['customer' => false, 'effort' => false]],
            ['bug', 'bug', Tone::Ochre, false, [
                'customer' => false, 'effort' => false, 'environment' => true, 'browser' => false, 'steps' => false,
            ]],
            ['epic', 'zap', Tone::Moss, true, [
                'target_quarter' => false, 'customer' => false,
            ]],
            ['wish', 'message-square-heart', Tone::Plum, false, [
                'customer' => true, 'ticket_url' => false, 'approved' => false, 'reviewer' => false,
            ]],
        ] as [$key, $icon, $tone, $isEpic, $asks]) {
            $type = WorkItemType::query()->updateOrCreate(['name' => DemoTexts::get("catalog.type.{$key}.name")], [
                'icon' => $icon,
                'tone' => $tone,
                'description' => DemoTexts::get("catalog.type.{$key}.description"),
                'is_epic' => $isEpic,
                'archived_at' => null,
            ]);

            // the properties it asks for, in this order (the shipped Bug asked for the effort alone)
            $position = 0;

            foreach ($asks as $key => $required) {
                TypeProperty::query()->updateOrCreate(
                    ['type_id' => $type->id, 'property_id' => $properties[$key]->id],
                    ['required' => $required, 'position' => $position++],
                );
            }
        }
    }

    private function labels(): void
    {
        foreach ([
            'ux' => Tone::Sky, 'forms' => Tone::Ochre, 'production' => Tone::Plum, 'performance' => Tone::Moss,
            'seo' => Tone::Sand, 'a11y' => Tone::Slate, 'backend' => Tone::Sky, 'design' => Tone::Plum,
        ] as $key => $color) {
            Label::query()->updateOrCreate(['name' => DemoTexts::get("catalog.label.{$key}")], ['color' => $color]);
        }
    }

    private function relationTypes(): void
    {
        // `relates` reads the same from both ends: it has no inward label
        foreach (['blocks' => true, 'duplicates' => true, 'relates' => false] as $builtIn => $directed) {
            RelationType::query()->updateOrCreate(['built_in' => $builtIn], [
                'name' => DemoTexts::get("catalog.relation.{$builtIn}.name"),
                'outward_label' => DemoTexts::get("catalog.relation.{$builtIn}.outward"),
                'inward_label' => $directed ? DemoTexts::get("catalog.relation.{$builtIn}.inward") : null,
            ]);
        }

        RelationType::query()->updateOrCreate(['name' => DemoTexts::get('catalog.relation.tests.name')], [
            'outward_label' => DemoTexts::get('catalog.relation.tests.outward'),
            'inward_label' => DemoTexts::get('catalog.relation.tests.inward'),
            'built_in' => null,
        ]);
    }
}
