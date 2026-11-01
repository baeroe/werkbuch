<?php

use App\Actions\WorkItems\UpdateWorkItem;
use App\Domain\Filter\Condition;
use App\Domain\Filter\Field;
use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\InvalidInput;
use App\Domain\Filter\Op;
use App\Domain\Properties\FieldType;
use App\Models\Organization;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Support\ItemValues;
use App\Views\CatalogProperties;
use App\Views\FilterQuery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\FilterWorld;

/*
 * The property cases of `matchesFilter` in `src/domain/filter.test.ts` of the clickdummy, with the same names, against
 * rows (FilterWorld is `fixtures.ts`, the properties are those of its `typeProperties`): today is Wednesday 2026-10-28
 * in Europe/Berlin, the week starts on Monday, the reader is Mara. WEB-47 is a bug for the customer Nordlicht with an
 * effort of 3.5.
 */

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'Europe/Berlin'));
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'week_start' => 1]);
    $w = $this->world = FilterWorld::build();

    $this->wish = WorkItemType::factory()->create(['name' => 'Kundenwunsch']);
    $property = fn (string $key, FieldType $type, array $settings = []) => Property::factory()->create(['key' => $key, 'label' => $key, 'field_type' => $type, 'settings' => $settings]);
    $this->properties = $p = [
        'customer' => Property::factory()->dropdown(['Nordlicht', 'Bäckerei Korn'])->create(['key' => 'customer', 'label' => 'Kunde']),
        // the built-in one, with one decimal
        'effort' => Property::query()->where('key', 'effort')->sole(),
        'environment' => Property::factory()->dropdown(['Produktion', 'Staging'])->create(['key' => 'environment', 'label' => 'Umgebung']),
        'browser' => $property('browser', FieldType::Text),
        'steps' => $property('steps', FieldType::RichText),
        'go_live' => $property('go_live', FieldType::Date),
        'ticket_url' => $property('ticket_url', FieldType::Url),
        'approved' => $property('approved', FieldType::Boolean),
        'reviewer' => $property('reviewer', FieldType::Member, ['multiple' => true]),
        'budget' => $property('budget', FieldType::Number, ['decimals' => 4]),
    ];
    // which properties a type has (Bug carries `effort`, as WEB-47 does in the demo; Task also the go-live date)
    $types = [
        [$w->task, ['customer', 'effort', 'go_live', 'budget']],
        [$w->bug, ['customer', 'effort', 'environment', 'browser', 'steps']],
        [$w->epic, ['customer']],
        [$this->wish, ['customer', 'ticket_url', 'approved', 'reviewer']],
    ];
    foreach ($types as [$type, $keys]) {
        $type->typeProperties()->delete();
        foreach ($keys as $position => $key) {
            $type->typeProperties()->create(['property_id' => $p[$key]->id, 'required' => false, 'position' => $position]);
        }
    }

    $this->option = fn (string $key, string $label): string => $p[$key]->options()->where('label', $label)->sole()->id;
    $this->values = function (WorkItem $item, array $values): WorkItem {
        ItemValues::store($item, $values, []);

        return $item;
    };
    ($this->values)($w->web47, ['customer' => ($this->option)('customer', 'Nordlicht'), 'effort' => 3.5]);

    // an org admin edits through the API (the one who may pick anybody in a person property)
    $this->admin = User::factory()->admin()->create(['name' => 'Erik Ende']);
    $this->update = fn (WorkItem $item, array $values): WorkItem => UpdateWorkItem::run(actor($this->admin), $item, ['values' => $values]);
});

/** A rich text document of one paragraph. */
$doc = fn (string $text): array => ['type' => 'doc', 'content' => [['type' => 'paragraph', 'content' => [['type' => 'text', 'text' => $text]]]]];

describe('matchesFilter', function () {
    it('property:customer in [option] matches the item with that customer', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'property:customer', 'op' => 'in', 'value' => [($this->option)('customer', 'Nordlicht')]]))->toBeTrue()
            ->and($this->world->matches($this->world->web47, ['field' => 'property:customer', 'op' => 'in', 'value' => [($this->option)('customer', 'Bäckerei Korn')]]))->toBeFalse();
    });

    it('property:effort gt 3 matches 3.5', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'property:effort', 'op' => 'gt', 'value' => 3]))->toBeTrue();
    });

    it('property:customer is_empty matches an epic without a customer', function () {
        expect($this->world->matches($this->world->epicWithoutCustomer, ['field' => 'property:customer', 'op' => 'is_empty']))->toBeTrue()
            ->and($this->world->matches($this->world->web47, ['field' => 'property:customer', 'op' => 'is_empty']))->toBeFalse();
    });
});

describe('properties', function () use ($doc) {
    it('number operators work on numbers', function () {
        $w = $this->world;
        $effort = fn (string $op, mixed $value) => $w->matches($w->web47, ['field' => 'property:effort', 'op' => $op, 'value' => $value]);

        expect($effort('lt', 4))->toBeTrue()
            ->and($effort('lt', 3.5))->toBeFalse()
            ->and($effort('is', 3.5))->toBeTrue()
            ->and($effort('between', [3, 4]))->toBeTrue()
            ->and($effort('between', [4, 8]))->toBeFalse()
            // both ends included
            ->and($effort('between', [3.5, 3.5]))->toBeTrue()
            ->and($effort('gt', 3.5))->toBeFalse()
            ->and($effort('gt', -1))->toBeTrue();
    });

    it('zero is a value, not empty', function () {
        $w = $this->world;
        $zero = ($this->values)($w->item(), ['effort' => 0]);

        expect($w->matches($zero, ['field' => 'property:effort', 'op' => 'is_empty']))->toBeFalse()
            ->and($w->matches($zero, ['field' => 'property:effort', 'op' => 'is_not_empty']))->toBeTrue()
            ->and($w->matches($zero, ['field' => 'property:effort', 'op' => 'is', 'value' => 0]))->toBeTrue();
    });

    it('is_empty is true for a missing value, an empty string and an empty list', function () {
        $w = $this->world;
        $wish = fn () => $w->item(['type_id' => $this->wish->id]);
        $empty = fn (WorkItem $item, string $key) => $w->matches($item, ['field' => "property:{$key}", 'op' => 'is_empty']);
        // saved through the API: an emptied value is no row
        $blankUrl = ($this->update)(($this->update)($wish(), ['ticket_url' => 'https://example.com/t/1']), ['ticket_url' => '  ']);
        $noReviewer = ($this->update)(($this->update)($wish(), ['reviewer' => [$this->admin->id]]), ['reviewer' => []]);
        $reviewed = ($this->update)($wish(), ['reviewer' => [$this->admin->id]]);

        expect($empty($wish(), 'ticket_url'))->toBeTrue()
            ->and($empty($blankUrl, 'ticket_url'))->toBeTrue()
            ->and($empty($noReviewer, 'reviewer'))->toBeTrue()
            ->and($empty($reviewed, 'reviewer'))->toBeFalse()
            ->and(DB::table('work_item_values')->whereIn('work_item_id', [$blankUrl->id, $noReviewer->id])->exists())->toBeFalse();
    });

    it('never matches a property the type does not have, not even is_empty', function () {
        $w = $this->world;
        $production = ($this->option)('environment', 'Produktion');

        // Epics have no environment
        expect($w->matches($w->epicWithoutCustomer, ['field' => 'property:environment', 'op' => 'is_empty']))->toBeFalse()
            ->and($w->matches($w->epicWithoutCustomer, ['field' => 'property:environment', 'op' => 'is_not', 'value' => $production]))->toBeFalse()
            ->and($w->matches($w->epicWithoutCustomer, ['field' => 'property:environment', 'op' => 'not_in', 'value' => [$production]]))->toBeFalse()
            // a bug without one does
            ->and($w->matches($w->item(['type_id' => $w->bug->id]), ['field' => 'property:environment', 'op' => 'is_not', 'value' => $production]))->toBeTrue();

        // without customer in the epic type: is_empty matches the task without a customer, not the epic
        $w->epic->typeProperties()->delete();
        $task = $w->item(['title' => 'Ohne Kunde']);

        expect($w->ids(['field' => 'property:customer', 'op' => 'is_empty'], ['field' => 'title', 'op' => 'contains', 'value' => 'Ohne Kunde']))->toBe([$task->id])
            ->and($w->matches($w->epicWithoutCustomer, ['field' => 'property:customer', 'op' => 'is_empty']))->toBeFalse()
            ->and($w->matches($w->epicChild, ['field' => 'property:customer', 'op' => 'is_empty']))->toBeTrue();
    });

    it('never matches a property the type does not have, not even is false', function () {
        $w = $this->world;
        // yes or no only in the type Bug
        $this->wish->typeProperties()->where('property_id', $this->properties['approved']->id)->delete();
        $w->bug->typeProperties()->create(['property_id' => $this->properties['approved']->id, 'required' => false, 'position' => 9]);
        $task = $w->item();
        $bug = $w->item(['type_id' => $w->bug->id]);

        expect($w->matches($task, ['field' => 'property:approved', 'op' => 'is', 'value' => false]))->toBeFalse()
            ->and($w->matches($bug, ['field' => 'property:approved', 'op' => 'is', 'value' => false]))->toBeTrue();
    });

    it('ignores a value row left from a type the item no longer has', function () {
        $w = $this->world;
        $task = $w->item();
        // a browser is a property of bugs only
        DB::table('work_item_values')->insert([
            'id' => strtolower((string) Str::ulid()), 'work_item_id' => $task->id, 'property_id' => $this->properties['browser']->id,
            'position' => 0, 'value_string' => 'Safari 19', 'created_at' => now(), 'updated_at' => now(),
        ]);

        expect($w->matches($task, ['field' => 'property:browser', 'op' => 'is_not_empty']))->toBeFalse()
            ->and($w->matches($task, ['field' => 'property:browser', 'op' => 'contains', 'value' => 'Safari']))->toBeFalse()
            // the same row on a bug counts
            ->and($w->matches(($this->values)($w->item(['type_id' => $w->bug->id]), ['browser' => 'Safari 19']), ['field' => 'property:browser', 'op' => 'is_not_empty']))->toBeTrue();
    });

    it('treats an unset boolean as false', function () {
        $w = $this->world;
        $unset = $w->item(['type_id' => $this->wish->id]);
        $approved = ($this->values)($w->item(['type_id' => $this->wish->id]), ['approved' => true]);
        $switchedOff = ($this->values)($w->item(['type_id' => $this->wish->id]), ['approved' => false]);
        $is = fn (WorkItem $item, bool $value) => $w->matches($item, ['field' => 'property:approved', 'op' => 'is', 'value' => $value]);

        expect($is($unset, false))->toBeTrue()
            ->and($is($unset, true))->toBeFalse()
            ->and($is($approved, true))->toBeTrue()
            ->and($is($approved, false))->toBeFalse()
            // false and no value read alike (A89)
            ->and($is($switchedOff, false))->toBeTrue()
            ->and($is($switchedOff, true))->toBeFalse()
            // yes or no is never empty: the schema offers only `is`
            ->and(Field::named('property:approved', CatalogProperties::load())?->ops())->toBe([Op::Is]);
    });

    it('matches multi-select values and resolves "me" in member properties', function () {
        $w = $this->world;
        $reviewed = ($this->values)($w->item(['type_id' => $this->wish->id]), ['reviewer' => [$w->ida->id, $w->mara->id]]);
        $reviewer = fn (string $op, array $value, ?User $reader = null) => $w->matchesFilter($reviewed, $w->filter(['field' => 'property:reviewer', 'op' => $op, 'value' => $value]), $reader);

        expect($reviewer('in', [$w->ida->id]))->toBeTrue()
            ->and($reviewer('in', ['me']))->toBeTrue()
            ->and($reviewer('in', ['me'], $w->jonas))->toBeFalse()
            ->and($reviewer('not_in', [$w->jonas->id]))->toBeTrue()
            ->and($reviewer('not_in', ['me']))->toBeFalse()
            ->and($reviewer('contains', [$w->ida->id]))->toBeTrue()
            ->and($reviewer('is', [strtoupper($w->ida->id)]))->toBeTrue()
            // `me` is no option of a dropdown: the schema refuses it there
            ->and(fn () => $w->filter(['field' => 'property:customer', 'op' => 'in', 'value' => ['me']]))->toThrow(InvalidInput::class);
    });

    it('not_in on a multi-select keeps items without the option, but only of types with the property', function () {
        $w = $this->world;
        $wish = fn (array $values) => ($this->values)($w->item(['type_id' => $this->wish->id, 'title' => 'Wunsch']), $values);
        $ida = $wish(['reviewer' => [$w->ida->id]]);
        $both = $wish(['reviewer' => [$w->ida->id, $w->jonas->id]]);
        $nobody = $wish([]);
        $task = $w->item(['title' => 'Wunsch']);

        expect($w->ids(['field' => 'property:reviewer', 'op' => 'not_in', 'value' => [$w->jonas->id]], ['field' => 'title', 'op' => 'contains', 'value' => 'Wunsch']))
            ->toBe(collect([$ida->id, $nobody->id])->sort()->values()->all())
            ->and($w->matches($both, ['field' => 'property:reviewer', 'op' => 'is_not', 'value' => $w->ida->id]))->toBeFalse()
            ->and($w->matches($task, ['field' => 'property:reviewer', 'op' => 'not_in', 'value' => [$w->jonas->id]]))->toBeFalse();
    });

    it('compares date properties with date operators', function () {
        $w = $this->world;
        $release = ($this->values)($w->item(), ['go_live' => '2026-11-02']);
        $goLive = fn (string $op, mixed $value) => $w->matches($release, ['field' => 'property:go_live', 'op' => $op, 'value' => $value]);

        expect($goLive('before', ['relative' => '+7d']))->toBeTrue()
            ->and($goLive('before', 'today'))->toBeFalse()
            ->and($goLive('after', 'today'))->toBeTrue()
            ->and($goLive('is', '2026-11-02'))->toBeTrue()
            ->and($goLive('is', '2026-11-01'))->toBeFalse()
            ->and($goLive('between', ['2026-11-01', '2026-11-02']))->toBeTrue()
            ->and($goLive('between', ['today', '2026-11-01']))->toBeFalse()
            // this week runs from Monday 10-26 to Sunday 11-01, next Monday is not in it
            ->and($goLive('is', 'this_week'))->toBeFalse()
            ->and($goLive('is', 'this_month'))->toBeFalse()
            ->and($w->matches(($this->values)($w->item(), ['go_live' => '2026-11-01']), ['field' => 'property:go_live', 'op' => 'is', 'value' => 'this_week']))->toBeTrue()
            ->and($w->matches(($this->values)($w->item(), ['go_live' => '2026-10-26']), ['field' => 'property:go_live', 'op' => 'is', 'value' => 'this_week']))->toBeTrue()
            ->and($w->matches(($this->values)($w->item(), ['go_live' => '2026-10-25']), ['field' => 'property:go_live', 'op' => 'is', 'value' => 'this_week']))->toBeFalse()
            ->and($goLive('is_not_empty', null))->toBeTrue();
    });

    it('contains searches text properties and the text of rich text properties', function () use ($doc) {
        $w = $this->world;
        $bug = ($this->values)($w->item(['type_id' => $w->bug->id]), ['browser' => 'Safari 19', 'steps' => $doc('Formular in Safari absenden')]);
        $words = ($this->values)($w->item(['type_id' => $w->bug->id]), ['steps' => $doc('Ein paragraph, wörtlich')]);
        $contains = fn (WorkItem $item, string $key, string $text) => $w->matches($item, ['field' => "property:{$key}", 'op' => 'contains', 'value' => $text]);

        expect($contains($bug, 'browser', 'safari'))->toBeTrue()
            ->and($contains($bug, 'steps', 'ABSENDEN'))->toBeTrue()
            ->and($contains($bug, 'steps', 'safari'))->toBeTrue()
            ->and($contains($bug, 'steps', 'chrome'))->toBeFalse()
            ->and($w->matches($bug, ['field' => 'property:steps', 'op' => 'is_empty']))->toBeFalse()
            // the text, not the JSON of the document: its node names are no words of it
            ->and($contains($bug, 'steps', 'paragraph'))->toBeFalse()
            ->and($contains($bug, 'steps', '"text"'))->toBeFalse()
            ->and($contains($words, 'steps', 'paragraph'))->toBeTrue()
            // `%` and `_` taken literally, as in the title
            ->and($contains($bug, 'steps', 'Formular_in'))->toBeFalse()
            ->and($contains($bug, 'browser', '%'))->toBeFalse();

        // an emptied document is no row (saved through the API)
        $emptied = ($this->update)(($this->update)($w->item(['type_id' => $w->bug->id]), ['steps' => $doc('Erst')]), ['steps' => ['type' => 'doc', 'content' => [['type' => 'paragraph']]]]);

        expect($w->matches($emptied, ['field' => 'property:steps', 'op' => 'is_empty']))->toBeTrue();
    });

    it('is on a text property ignores case', function () {
        $w = $this->world;
        $bug = ($this->values)($w->item(['type_id' => $w->bug->id]), ['browser' => 'Safari 19']);
        $url = ($this->values)($w->item(['type_id' => $this->wish->id]), ['ticket_url' => 'https://example.com/T/1']);

        expect($w->matches($bug, ['field' => 'property:browser', 'op' => 'is', 'value' => 'SAFARI 19']))->toBeTrue()
            ->and($w->matches($bug, ['field' => 'property:browser', 'op' => 'is', 'value' => 'Safari']))->toBeFalse()
            ->and($w->matches($url, ['field' => 'property:ticket_url', 'op' => 'is', 'value' => 'https://example.com/t/1']))->toBeTrue()
            ->and($w->matches($url, ['field' => 'property:ticket_url', 'op' => 'contains', 'value' => 'example']))->toBeTrue();
    });

    it('compares numbers with more than 14 digits exactly', function () {
        $w = $this->world;
        $large = ($this->update)($w->item(), ['budget' => 123456789012.3456]);
        $budget = fn (string $op, mixed $value) => $w->matches($large, ['field' => 'property:budget', 'op' => $op, 'value' => $value]);

        expect($budget('is', 123456789012.3456))->toBeTrue()
            ->and($budget('gt', 123456789012.3455))->toBeTrue()
            ->and($budget('gt', 123456789012.3456))->toBeFalse()
            ->and($budget('lt', 123456789012.3457))->toBeTrue()
            ->and($budget('between', [123456789012.3456, 123456789012.3456]))->toBeTrue()
            // bound as a float, PDO would send 14 digits (123456789012.35) and `is` would miss it
            ->and(DB::table('work_item_values')->where('work_item_id', $large->id)->where('value_number', 123456789012.3456)->exists())->toBeFalse()
            ->and(DB::table('work_item_values')->where('work_item_id', $large->id)->where('value_number', '123456789012.3456')->exists())->toBeTrue();
    });

    it('rounds a number to the four decimals of the column and takes the largest one below the limit', function () {
        $w = $this->world;
        $item = ($this->values)($w->item(), ['budget' => 2.5]);
        $huge = ($this->values)($w->item(), ['budget' => 99999999999999983616.0]);
        $budget = fn (WorkItem $item, string $op, mixed $value) => $w->matches($item, ['field' => 'property:budget', 'op' => $op, 'value' => $value]);

        expect($budget($item, 'is', 2.50004))->toBeTrue()
            ->and($budget($item, 'is', 2.50006))->toBeFalse()
            ->and($budget($huge, 'is', 99999999999999983616.0))->toBeTrue()
            ->and($budget($huge, 'gt', -99999999999999983616.0))->toBeTrue()
            ->and($budget($item, 'lt', 99999999999999983616.0))->toBeTrue();
    });

    it('refuses a number of 10^20 or more', function () {
        $refusal = function (array $condition): array {
            try {
                FilterSchema::parse(['version' => 1, 'conditions' => [$condition]], CatalogProperties::load());
            } catch (InvalidInput $invalid) {
                return $invalid->errorsAt('filter');
            }

            return [];
        };

        expect($refusal(['field' => 'property:effort', 'op' => 'gt', 'value' => 1e20]))->toBe(['filter.conditions.0.value' => 'value'])
            ->and($refusal(['field' => 'property:effort', 'op' => 'between', 'value' => [0, -1e20]]))->toBe(['filter.conditions.0.value' => 'value'])
            ->and($refusal(['field' => 'property:effort', 'op' => 'gt', 'value' => 99999999999999983616.0]))->toBe([]);
    });

    it('matches nothing for an operator or a value its property does not take', function (string $key, Op $op, mixed $value) {
        // only conditions made by hand get here: the schema offers neither
        $field = Field::named("property:{$key}", CatalogProperties::load());
        $filter = new Filter([new Condition("property:{$key}", $op, $value, $field)]);

        expect(FilterQuery::apply(WorkItem::query(), $filter, $this->world->mara)->exists())->toBeFalse();
    })->with([
        'dropdown before' => ['customer', Op::Before, 'x'],
        'person gt' => ['reviewer', Op::Gt, 3],
        'yes or no is_not' => ['approved', Op::IsNot, true],
        'yes or no is a word' => ['approved', Op::Is, 'yes'],
        'number contains' => ['effort', Op::Contains, '3'],
        'number is a text' => ['effort', Op::Is, '3.5'],
        'number between one' => ['effort', Op::Between, [3]],
        'date contains' => ['go_live', Op::Contains, '2026'],
        'date overdue' => ['go_live', Op::Overdue, null],
        'text before' => ['browser', Op::Before, 'x'],
        'text contains a number' => ['browser', Op::Contains, 19],
        'rich text is' => ['steps', Op::Is, 'Formular'],
    ]);

    it('qualifies every column, so a join does not make it ambiguous', function () {
        $w = $this->world;
        // work_item_types, properties and type_properties have `id`, `key`, `type_id` or `property_id` as well
        $query = WorkItem::query()->select('work_items.*')
            ->join('work_item_types', 'work_item_types.id', '=', 'work_items.type_id')
            ->join('type_properties', 'type_properties.type_id', '=', 'work_items.type_id')
            ->join('properties', 'properties.id', '=', 'type_properties.property_id')
            ->where('properties.key', 'customer');

        expect(FilterQuery::apply($query, $w->filter(
            ['field' => 'property:customer', 'op' => 'is', 'value' => ($this->option)('customer', 'Nordlicht')],
            ['field' => 'property:effort', 'op' => 'is_not_empty'],
        ), $w->mara)->pluck('work_items.id')->all())->toBe([$w->web47->id]);
    });

    it('asks the database a fixed number of times', function () {
        $w = $this->world;
        $filter = $w->filter(
            ['field' => 'property:customer', 'op' => 'in', 'value' => [($this->option)('customer', 'Nordlicht')]],
            ['field' => 'property:effort', 'op' => 'gt', 'value' => 3],
            ['field' => 'property:approved', 'op' => 'is', 'value' => false],
            ['field' => 'property:go_live', 'op' => 'is', 'value' => 'this_week'],
            ['field' => 'property:browser', 'op' => 'is', 'value' => 'x'],
            ['field' => 'property:steps', 'op' => 'contains', 'value' => 'x'],
            ['field' => 'property:reviewer', 'op' => 'not_in', 'value' => ['me']],
            ['field' => 'property:ticket_url', 'op' => 'is_empty'],
        );
        Organization::current();

        DB::enableQueryLog();
        $query = FilterQuery::apply(WorkItem::query(), $filter, $w->mara);
        $before = count(DB::getQueryLog());
        $query->get();

        expect($before)->toBe(0)->and(DB::getQueryLog())->toHaveCount(1);
    });
});
