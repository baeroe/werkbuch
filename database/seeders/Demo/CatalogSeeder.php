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
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

/**
 * The catalog of the clickdummy (src/api/seed/config.ts, src/domain/fixtures.ts): the German texts of the shipped
 * entries, the workflow „Agentur-Freigabe“, the properties, the type „Kundenwunsch“, the labels and the relation type
 * „testet“. Every entry is found by a stable key (workflow, type and label name, property key, `built_in` or name of a
 * relation type), so running it again changes nothing. It never moves the mark of the default workflow and never
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
        // the shipped workflow gets its German text, if it still has its name; it is never created here: the migration
        // made it with its states, an empty one of that name would be no workflow at all
        Workflow::query()->where('name', 'Standard')->first()?->update([
            'description' => 'Der Standard-Workflow: Jeder Status ist von überall erreichbar.',
        ]);

        // never the default when it is made, and it keeps the mark if an admin gave it one: one default at all times
        $agency = Workflow::query()->firstOrNew(['name' => 'Agentur-Freigabe'], ['is_default' => false]);
        $agency->fill([
            'description' => 'Mit interner Prüfung und Kundenfreigabe vor dem Abschluss.',
            'is_free' => false,
        ])->save();

        /** @var array<string, WorkflowState> $states by name */
        $states = [];

        foreach ([
            ['Backlog', StateIcon::Dashed, StateCategory::Backlog],
            ['Todo', StateIcon::Circle, StateCategory::Unstarted],
            ['In Progress', StateIcon::Half, StateCategory::Started],
            ['Review', StateIcon::ThreeQuarter, StateCategory::Started],
            ['Kundenfreigabe', StateIcon::Pause, StateCategory::Started],
            ['Done', StateIcon::Check, StateCategory::Completed],
            ['Cancelled', StateIcon::Cross, StateCategory::Canceled],
        ] as $position => [$name, $icon, $category]) {
            $states[$name] = WorkflowState::query()->updateOrCreate(
                ['workflow_id' => $agency->id, 'name' => $name],
                ['icon' => $icon, 'category' => $category, 'position' => $position],
            );
        }

        $agency->update(['initial_state_id' => $states['Backlog']->id]);

        // only these moves are allowed; every open status can be cancelled, Done and Cancelled reopen
        foreach ([
            ['Backlog', 'Todo'], ['Todo', 'In Progress'], ['In Progress', 'Review'], ['Review', 'In Progress'],
            ['Review', 'Kundenfreigabe'], ['Kundenfreigabe', 'Done'], ['Kundenfreigabe', 'In Progress'],
            ['Backlog', 'Cancelled'], ['Todo', 'Cancelled'], ['In Progress', 'Cancelled'], ['Review', 'Cancelled'], ['Kundenfreigabe', 'Cancelled'],
            ['Done', 'Todo'], ['Cancelled', 'Backlog'],
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
            ['customer', 'Kunde', FieldType::Dropdown, 'Für wen das Item gemacht wird.', [], [
                ['Studio Nordlicht', Tone::Sky], ['Hafenkontor', Tone::Ochre], ['Gärtnerei Moos', Tone::Moss],
            ], null],
            ['effort', 'Aufwand (h)', FieldType::Number, 'Geschätzte Stunden, auf eine Nachkommastelle.', ['decimals' => 1], [], null],
            ['environment', 'Umgebung', FieldType::Dropdown, 'Wo der Fehler aufgetreten ist.', [], [
                ['Produktion', Tone::Plum], ['Staging', Tone::Ochre], ['Lokal', Tone::Slate],
            ], null],
            ['browser', 'Browser', FieldType::Text, 'Browser und Version, z. B. „Safari 18 auf iOS“.', [], [], null],
            ['ticket_url', 'Ticket beim Kunden', FieldType::Url, 'Link auf das Ticket im System des Kunden.', [], [], null],
            ['approved', 'Abgenommen', FieldType::Boolean, 'Der Kunde hat die Umsetzung abgenommen.', [], [], false],
            ['reviewer', 'Reviewer', FieldType::Member, 'Wer das Ergebnis prüft.', [], [], null],
            ['steps', 'Schritte zum Nachstellen', FieldType::RichText, 'So lässt sich der Fehler reproduzieren.', [], [], null],
            ['target_quarter', 'Zielquartal', FieldType::Dropdown, 'Bis wann das Vorhaben fertig sein soll.', [], [
                ['Q4 2026', Tone::Sky], ['Q1 2027', Tone::Moss], ['Q2 2027', Tone::Sand],
            ], null],
        ] as [$key, $label, $fieldType, $help, $settings, $options, $default]) {
            $property = Property::query()->updateOrCreate(['key' => $key], [
                'label' => $label,
                'field_type' => $fieldType,
                'help' => $help,
                'settings' => $settings,
                'default_value' => $default,
            ]);

            foreach ($options as $position => [$optionLabel, $color]) {
                PropertyOption::query()->updateOrCreate(
                    ['property_id' => $property->id, 'label' => $optionLabel],
                    ['color' => $color, 'position' => $position, 'archived_at' => null],
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
            ['Task', 'square-check', Tone::Sky, 'Eine Aufgabe, die jemand erledigt.', false, ['customer' => false, 'effort' => false]],
            ['Bug', 'bug', Tone::Ochre, 'Ein Fehler, der behoben werden muss. Die Umgebung, in der er auftritt, ist Pflicht.', false, [
                'customer' => false, 'effort' => false, 'environment' => true, 'browser' => false, 'steps' => false,
            ]],
            ['Epic', 'zap', Tone::Moss, 'Ein größeres Vorhaben, das in Items zerfällt. Erscheint in der Timeline.', true, [
                'target_quarter' => false, 'customer' => false,
            ]],
            ['Kundenwunsch', 'message-square-heart', Tone::Plum, 'Ein Wunsch einer Kundin oder eines Kunden, der vor der Umsetzung freigegeben wird.', false, [
                'customer' => true, 'ticket_url' => false, 'approved' => false, 'reviewer' => false,
            ]],
        ] as [$name, $icon, $tone, $description, $isEpic, $asks]) {
            $type = WorkItemType::query()->updateOrCreate(['name' => $name], [
                'icon' => $icon,
                'tone' => $tone,
                'description' => $description,
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
            ['UX', Tone::Sky], ['Formulare', Tone::Ochre], ['Produktion', Tone::Plum], ['Performance', Tone::Moss],
            ['SEO', Tone::Sand], ['Barrierefreiheit', Tone::Slate], ['Backend', Tone::Sky], ['Design', Tone::Plum],
        ] as [$name, $color]) {
            Label::query()->updateOrCreate(['name' => $name], ['color' => $color]);
        }
    }

    private function relationTypes(): void
    {
        foreach ([
            ['blocks', 'blockiert', 'blockiert', 'wird blockiert von'],
            ['duplicates', 'Duplikat', 'ist Duplikat von', 'hat Duplikat'],
            ['relates', 'verwandt', 'verwandt mit', null],
        ] as [$builtIn, $name, $outward, $inward]) {
            RelationType::query()->updateOrCreate(['built_in' => $builtIn], [
                'name' => $name,
                'outward_label' => $outward,
                'inward_label' => $inward,
            ]);
        }

        RelationType::query()->updateOrCreate(['name' => 'testet'], [
            'outward_label' => 'testet',
            'inward_label' => 'wird getestet von',
            'built_in' => null,
        ]);
    }
}
