<?php

namespace Database\Seeders\Load;

use App\Access\OrgRole;
use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Catalog\Tone;
use App\Domain\Properties\FieldType;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Enums\ProjectVisibility;
use App\Models\Label;
use App\Models\Project;
use App\Models\Property;
use App\Models\PropertyOption;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\TypeProperty;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkflowState;
use App\Models\WorkItemType;
use Faker\Generator;

/**
 * The frame of the load data: three more properties on every type (a date, a text, a dropdown; `effort` on every type
 * too), 30 people `load-NN@example.com` (load-01 is the org admin), 5 bots and 20 projects `L01` … `L20`
 * „Lastprojekt NN“. L01–L10 work with the default workflow, L11–L20 with „Agentur-Freigabe“ (so lists over every
 * project mix two workflows); every fourth project is private. Each project has its lead, 12 more people and a bot.
 * Needs the demo catalog before it (Demo\CatalogSeeder).
 *
 * @phpstan-type Frame array{
 *     admin: string,
 *     people: list<array{id: string, handle: string}>,
 *     bots: list<string>,
 *     types: array{task: string, bug: string, epic: string, wish: string},
 *     labels: list<string>,
 *     relationTypes: array{blocks: string, relates: string, duplicates: string, tests: string},
 *     resolutions: array{completed: string, canceled: string},
 *     properties: array{effort: string, deadline: string, note: string, area: string},
 *     areaOptions: list<string>,
 *     projects: list<array{id: string, identifier: string, people: list<string>, bot: string, wishes: bool, states: list<array{id: string, category: string}>}>
 * }
 */
final class LoadCatalog
{
    public const PROJECTS = 20;

    public const PEOPLE = 30;

    public const BOTS = 5;

    public const PASSWORD = 'werkbuch-load';

    private const AREAS = [['Frontend', Tone::Sky], ['Backend', Tone::Moss], ['Betrieb', Tone::Ochre], ['Design', Tone::Plum], ['Inhalt', Tone::Sand], ['Support', Tone::Slate]];

    public function __construct(private readonly RoleAssignments $roles, private readonly Generator $faker) {}

    /**
     * @return Frame
     */
    public function run(): array
    {
        [$properties, $areaOptions] = $this->properties();
        [$admin, $people, $bots] = $this->accounts();

        $types = WorkItemType::query()->pluck('id', 'name');
        $relationTypes = RelationType::query()->get();

        return [
            'admin' => $admin,
            'people' => $people,
            'bots' => $bots,
            'types' => ['task' => (string) $types['Task'], 'bug' => (string) $types['Bug'], 'epic' => (string) $types['Epic'], 'wish' => (string) $types['Kundenwunsch']],
            'labels' => array_values(Label::query()->orderBy('id')->pluck('id')->map(fn ($id) => (string) $id)->all()),
            'relationTypes' => [
                'blocks' => (string) $relationTypes->firstWhere('built_in', 'blocks')?->id,
                'relates' => (string) $relationTypes->firstWhere('built_in', 'relates')?->id,
                'duplicates' => (string) $relationTypes->firstWhere('built_in', 'duplicates')?->id,
                'tests' => (string) $relationTypes->firstWhere('name', 'testet')?->id,
            ],
            'resolutions' => [
                'completed' => (string) Resolution::query()->where('default_for', 'completed')->value('id'),
                'canceled' => (string) Resolution::query()->where('default_for', 'canceled')->value('id'),
            ],
            'properties' => $properties,
            'areaOptions' => $areaOptions,
            'projects' => $this->projects($people, $bots, $types->all()),
        ];
    }

    /**
     * `effort`, a date, a text and a dropdown on every type, after the properties each type asks for already.
     *
     * @return array{0: array{effort: string, deadline: string, note: string, area: string}, 1: list<string>}
     */
    private function properties(): array
    {
        $deadline = Property::query()->updateOrCreate(['key' => 'load_deadline'], ['label' => 'Abnahme am', 'field_type' => FieldType::Date, 'help' => '', 'settings' => [], 'default_value' => null]);
        $note = Property::query()->updateOrCreate(['key' => 'load_note'], ['label' => 'Notiz', 'field_type' => FieldType::Text, 'help' => '', 'settings' => [], 'default_value' => null]);
        $area = Property::query()->updateOrCreate(['key' => 'load_area'], ['label' => 'Bereich', 'field_type' => FieldType::Dropdown, 'help' => '', 'settings' => [], 'default_value' => null]);
        $effort = Property::query()->where('key', 'effort')->sole();

        $options = [];
        foreach (self::AREAS as $position => [$label, $color]) {
            $options[] = (string) PropertyOption::query()->updateOrCreate(['property_id' => $area->id, 'label' => $label], ['color' => $color, 'position' => $position])->id;
        }

        foreach (WorkItemType::query()->get() as $type) {
            $position = (int) TypeProperty::query()->where('type_id', $type->id)->max('position');
            foreach ([$effort, $deadline, $note, $area] as $property) {
                TypeProperty::query()->firstOrCreate(
                    ['type_id' => $type->id, 'property_id' => $property->id],
                    ['required' => false, 'position' => ++$position],
                );
            }
        }

        return [['effort' => (string) $effort->id, 'deadline' => (string) $deadline->id, 'note' => (string) $note->id, 'area' => (string) $area->id], $options];
    }

    /**
     * @return array{0: string, 1: list<array{id: string, handle: string}>, 2: list<string>}
     */
    private function accounts(): array
    {
        $people = [];
        for ($n = 1; $n <= self::PEOPLE; $n++) {
            $handle = sprintf('load-%02d', $n);
            $user = User::query()->forceCreate([
                'type' => AccountType::Person,
                'name' => $this->faker->firstName().' '.$this->faker->lastName(),
                'handle' => $handle,
                'email' => "{$handle}@example.com",
                'password' => self::PASSWORD,
                'locale' => Locale::De,
                'timezone' => 'Europe/Berlin',
            ]);
            $this->roles->setOrgRole($user, $n === 1 ? OrgRole::Admin : OrgRole::Member);
            $people[] = ['id' => (string) $user->id, 'handle' => $handle];
        }

        $bots = [];
        for ($n = 1; $n <= self::BOTS; $n++) {
            $bot = User::query()->forceCreate([
                'type' => AccountType::Bot,
                'name' => "Lastbot {$n}",
                'handle' => "load-bot-{$n}",
                'owner_id' => $people[0]['id'],
                'description' => 'Bot der Lastdaten.',
                'locale' => Locale::De,
                'timezone' => 'Europe/Berlin',
            ]);
            $this->roles->setOrgRole($bot, OrgRole::Member);
            $bots[] = (string) $bot->id;
        }

        return [$people[0]['id'], $people, $bots];
    }

    /**
     * @param  list<array{id: string, handle: string}>  $people
     * @param  list<string>  $bots
     * @param  array<string, string>  $types  by name
     * @return list<array{id: string, identifier: string, people: list<string>, bot: string, wishes: bool, states: list<array{id: string, category: string}>}>
     */
    private function projects(array $people, array $bots, array $types): array
    {
        $default = Workflow::default();
        $agency = Workflow::query()->where('name', 'Agentur-Freigabe')->sole();
        $projects = [];

        for ($p = 1; $p <= self::PROJECTS; $p++) {
            $workflow = $p <= 10 ? $default : $agency;
            $wishes = $workflow->is($agency);
            // the lead and 12 more people, a different group per project (the org admin load-01 sees every project anyway)
            $members = [];
            for ($i = 0; $i < 13; $i++) {
                $members[] = $people[($p + $i * 2) % self::PEOPLE];
            }
            $members = array_values(array_unique($members, SORT_REGULAR));

            $project = Project::query()->forceCreate([
                'identifier' => sprintf('L%02d', $p),
                'name' => sprintf('Lastprojekt %02d', $p),
                'description' => 'Projekt der Lastdaten.',
                'lead_id' => $members[0]['id'],
                'visibility' => $p % 4 === 0 ? ProjectVisibility::Private : ProjectVisibility::Public,
                'workflow_id' => $workflow->id,
                'default_type_id' => $types['Task'],
                'next_number' => LoadItems::PER_PROJECT,
            ]);
            $project->types()->sync(array_values(array_filter([$types['Task'], $types['Bug'], $types['Epic'], $wishes ? $types['Kundenwunsch'] : null])));

            foreach ($members as $index => $member) {
                $role = match (true) {
                    $index < 2 => ProjectRole::Admin,
                    $index === count($members) - 1 => ProjectRole::Viewer,
                    default => ProjectRole::Member,
                };
                $this->roles->setProjectRole(User::query()->findOrFail($member['id']), $project, $role);
            }
            $bot = $bots[$p % self::BOTS];
            $this->roles->setProjectRole(User::query()->findOrFail($bot), $project, ProjectRole::Member);

            $projects[] = [
                'id' => (string) $project->id,
                'identifier' => (string) $project->identifier,
                // the ones who create, take and comment on items: never the viewer
                'people' => array_map(fn (array $member) => $member['id'], array_slice($members, 0, -1)),
                'bot' => $bot,
                'wishes' => $wishes,
                'states' => array_values(WorkflowState::query()->where('workflow_id', $workflow->id)->orderBy('position')->get()
                    ->map(fn (WorkflowState $state) => ['id' => (string) $state->id, 'category' => $state->category->value])->all()),
            ];
        }

        return $projects;
    }
}
