<?php

use App\Domain\Filter\Condition;
use App\Domain\Filter\CoreField;
use App\Domain\Filter\Field;
use App\Domain\Filter\Filter;
use App\Domain\Filter\FilterSchema;
use App\Domain\Filter\Op;
use App\Models\Organization;
use App\Models\WorkItem;
use App\Models\WorkItemRelation;
use App\Models\WorkItemSubscriber;
use App\Views\CatalogProperties;
use App\Views\FilterQuery;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Support\FilterWorld;

/*
 * The cases of `matchesFilter` in `src/domain/filter.test.ts` of the clickdummy, with the same names, against rows
 * (FilterWorld is `fixtures.ts`): today is Wednesday 2026-10-28 in Europe/Berlin, the week starts on Monday, the reader
 * is Mara. The property cases are in FilterPropertiesTest. Where the clickdummy has no time zone (its `ctx`, the UTC
 * day), the organisation is set to UTC.
 */

beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-10-28 10:00', 'Europe/Berlin'));
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'week_start' => 1]);
    $this->world = FilterWorld::build();
});

describe('matchesFilter', function () {
    it('assignee in ["me"] does not match an item of somebody else', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'assignee', 'op' => 'in', 'value' => ['me']]))->toBeFalse();
    });

    it('due_date before +7d matches an item due in three days', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => '+7d']]))->toBeTrue();
    });

    it('due_date before +3d does not match an item due exactly then (before is strict)', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'due_date', 'op' => 'before', 'value' => ['relative' => '+3d']]))->toBeFalse();
    });

    it('state_category in [unstarted, started] matches a started item', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'state_category', 'op' => 'in', 'value' => ['unstarted', 'started']]))->toBeTrue();
    });

    it('title contains ignores case', function () {
        expect($this->world->matches($this->world->web47, ['field' => 'title', 'op' => 'contains', 'value' => 'KONTAKT']))->toBeTrue();
    });

    it('overdue matches an open item past its due date', function () {
        expect($this->world->matches($this->world->overdueStarted, ['field' => 'due_date', 'op' => 'overdue']))->toBeTrue();
    });

    it('overdue does not match a closed item', function () {
        expect($this->world->matches($this->world->overdueDone, ['field' => 'due_date', 'op' => 'overdue']))->toBeFalse();
    });

    it('an empty filter matches everything', function () {
        $w = $this->world;

        expect($w->matchesFilter($w->web47, Filter::empty()))->toBeTrue()
            ->and(FilterQuery::apply(WorkItem::query(), Filter::empty(), $w->mara)->count())->toBe(WorkItem::query()->count())
            ->and(WorkItem::query()->count())->toBe(6);
    });

    describe('combining conditions', function () {
        it('joins conditions with AND', function () {
            $w = $this->world;
            $jonas = ['field' => 'assignee', 'op' => 'in', 'value' => [$w->jonas->id]];

            expect($w->matches($w->web47, $jonas, ['field' => 'priority', 'op' => 'is', 'value' => 'urgent']))->toBeTrue()
                ->and($w->matches($w->web47, $jonas, ['field' => 'priority', 'op' => 'is', 'value' => 'high']))->toBeFalse()
                // only the item that meets both: Jonas has three items, one of them urgent
                ->and($w->ids($jonas, ['field' => 'priority', 'op' => 'is', 'value' => 'urgent']))->toBe([$w->web47->id])
                ->and($w->ids($jonas))->toHaveCount(3);
        });

        it('never matches a field it does not know', function () {
            $nope = FilterSchema::read(['version' => 1, 'conditions' => [['field' => 'nope', 'op' => 'is', 'value' => 1]]], CatalogProperties::load());

            expect($this->world->matchesFilter($this->world->web47, $nope))->toBeFalse();
        });
    });

    describe('id and enum fields', function () {
        it('resolves "me" to the signed-in account', function () {
            $w = $this->world;
            $mine = $w->item(['assignee_id' => $w->mara->id]);
            $byJonas = $w->item(['created_by' => $w->jonas->id]);

            expect($w->matches($mine, ['field' => 'assignee', 'op' => 'in', 'value' => ['me']]))->toBeTrue()
                ->and($w->matches($mine, ['field' => 'assignee', 'op' => 'is', 'value' => 'me']))->toBeTrue()
                ->and($w->matches($w->item(['created_by' => $w->mara->id]), ['field' => 'created_by', 'op' => 'is', 'value' => 'me']))->toBeTrue()
                ->and($w->matches($byJonas, ['field' => 'created_by', 'op' => 'is', 'value' => 'me']))->toBeFalse()
                // `me` is whoever reads
                ->and($w->matchesFilter($mine, $w->filter(['field' => 'assignee', 'op' => 'is', 'value' => 'me']), $w->jonas))->toBeFalse()
                ->and($w->matchesFilter($byJonas, $w->filter(['field' => 'created_by', 'op' => 'is', 'value' => 'me']), $w->jonas))->toBeTrue();
        });

        it('is_not and not_in include unassigned items', function () {
            $w = $this->world;
            $mine = $w->item(['assignee_id' => $w->mara->id]);
            $unassigned = $w->item(['assignee_id' => null]);

            expect($w->matches($unassigned, ['field' => 'assignee', 'op' => 'is_not', 'value' => 'me']))->toBeTrue()
                ->and($w->matches($unassigned, ['field' => 'assignee', 'op' => 'not_in', 'value' => [$w->jonas->id]]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'assignee', 'op' => 'not_in', 'value' => [$w->jonas->id]]))->toBeFalse()
                ->and($w->matches($mine, ['field' => 'assignee', 'op' => 'is_not', 'value' => 'me']))->toBeFalse()
                // the parent as well: an item without one is not that one
                ->and($w->matches($w->web47, ['field' => 'parent', 'op' => 'is_not', 'value' => $w->epicWithoutCustomer->id]))->toBeTrue()
                ->and($w->matches($w->epicChild, ['field' => 'parent', 'op' => 'not_in', 'value' => [$w->epicWithoutCustomer->id]]))->toBeFalse();
        });

        it('is_empty and is_not_empty look at the assignee', function () {
            $w = $this->world;
            $unassigned = $w->item(['assignee_id' => null]);

            expect($w->matches($unassigned, ['field' => 'assignee', 'op' => 'is_empty']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'assignee', 'op' => 'is_empty']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'assignee', 'op' => 'is_not_empty']))->toBeTrue();
        });

        it('matches priority, project, type and state', function () {
            $w = $this->world;

            expect($w->matches($w->web47, ['field' => 'priority', 'op' => 'is', 'value' => 'urgent']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'priority', 'op' => 'in', 'value' => ['high', 'medium']]))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'project', 'op' => 'in', 'value' => [$w->web->id, $w->ops->id]]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'type', 'op' => 'is', 'value' => $w->bug->id]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'state', 'op' => 'in', 'value' => [$w->state('In Progress')]]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'state_category', 'op' => 'not_in', 'value' => ['completed', 'canceled']]))->toBeTrue()
                // and their negations
                ->and($w->matches($w->web47, ['field' => 'priority', 'op' => 'is_not', 'value' => 'urgent']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'project', 'op' => 'not_in', 'value' => [$w->ops->id]]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'type', 'op' => 'is_not', 'value' => $w->bug->id]))->toBeFalse()
                ->and($w->matches($w->overdueDone, ['field' => 'state_category', 'op' => 'not_in', 'value' => ['completed', 'canceled']]))->toBeFalse()
                ->and($w->matches($w->overdueDone, ['field' => 'state_category', 'op' => 'is', 'value' => 'completed']))->toBeTrue();
        });

        it('matches the parent', function () {
            $w = $this->world;
            $child = $w->item(['parent_id' => $w->epicWithoutCustomer->id]);

            expect($w->matches($child, ['field' => 'parent', 'op' => 'is', 'value' => $w->epicWithoutCustomer->id]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'parent', 'op' => 'is_empty']))->toBeTrue()
                ->and($w->matches($child, ['field' => 'parent', 'op' => 'is_empty']))->toBeFalse()
                ->and($w->matches($child, ['field' => 'parent', 'op' => 'is_not_empty']))->toBeTrue()
                ->and($w->ids(['field' => 'parent', 'op' => 'is', 'value' => $w->epicWithoutCustomer->id]))
                ->toEqualCanonicalizing([$w->epicChild->id, $child->id]);
        });
    });

    describe('labels', function () {
        it('in matches when any label is in the list', function () {
            $w = $this->world;

            expect($w->matches($w->web47, ['field' => 'label', 'op' => 'in', 'value' => [$w->forms->id, $w->ux->id]]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'in', 'value' => [$w->ux->id]]))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'is', 'value' => $w->production->id]))->toBeTrue();
        });

        it('not_in matches only when none of the labels is in the list', function () {
            $w = $this->world;

            expect($w->matches($w->web47, ['field' => 'label', 'op' => 'not_in', 'value' => [$w->forms->id]]))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'not_in', 'value' => [$w->ux->id]]))->toBeTrue()
                // an item without labels has none of them
                ->and($w->matches($w->ops12, ['field' => 'label', 'op' => 'is_not', 'value' => $w->forms->id]))->toBeTrue();
        });

        it('is_empty matches an item without labels; contains is membership', function () {
            $w = $this->world;

            expect($w->matches($w->item(), ['field' => 'label', 'op' => 'is_empty']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'is_empty']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'is_not_empty']))->toBeTrue()
                ->and($w->matches($w->ops12, ['field' => 'label', 'op' => 'is_not_empty']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'contains', 'value' => $w->production->id]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'label', 'op' => 'contains', 'value' => $w->ux->id]))->toBeFalse();
        });
    });

    describe('dates', function () {
        it('after is strict as well', function () {
            $w = $this->world;

            expect($w->matches($w->web47, ['field' => 'due_date', 'op' => 'after', 'value' => ['relative' => '+2d']]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'due_date', 'op' => 'after', 'value' => ['relative' => '+3d']]))->toBeFalse();
        });

        it('between includes both ends', function () {
            $w = $this->world;
            $between = fn (string $from, string $to) => ['field' => 'due_date', 'op' => 'between', 'value' => [$from, $to]];

            expect($w->matches($w->web47, $between('2026-10-28', '2026-10-31')))->toBeTrue()
                ->and($w->matches($w->web47, $between('2026-10-31', '2026-11-05')))->toBeTrue()
                ->and($w->matches($w->web47, $between('2026-11-01', '2026-11-05')))->toBeFalse()
                ->and($w->matches($w->web47, $between('2026-10-31', '2026-10-31')))->toBeTrue();
        });

        it('between accepts relative ends', function () {
            $inTheNextWeek = ['field' => 'due_date', 'op' => 'between', 'value' => [['relative' => '0d'], ['relative' => '+1w']]];

            expect($this->world->matches($this->world->web47, $inTheNextWeek))->toBeTrue();
        });

        it('understands today and negative relative values', function () {
            $w = $this->world;
            $dueToday = $w->item(['due_date' => '2026-10-28']);

            expect($w->matches($dueToday, ['field' => 'due_date', 'op' => 'is', 'value' => 'today']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'due_date', 'op' => 'is', 'value' => 'today']))->toBeFalse()
                ->and($w->matches($dueToday, ['field' => 'due_date', 'op' => 'after', 'value' => ['relative' => '-1w']]))->toBeTrue();
        });

        it('this_week follows the first day of the week of the organisation', function () {
            $w = $this->world;
            $dueSunday = $w->item(['due_date' => '2026-11-01']);
            $thisWeek = ['field' => 'due_date', 'op' => 'is', 'value' => 'this_week'];

            // Monday 2026-10-26 to Sunday 2026-11-01
            expect($w->matches($dueSunday, $thisWeek))->toBeTrue();

            // Sunday 2026-10-25 to Saturday 2026-10-31
            Organization::current()->update(['week_start' => 0]);

            expect($w->matches($dueSunday, $thisWeek))->toBeFalse()
                ->and($w->matches($w->web47, $thisWeek))->toBeTrue();
        });

        it('this_month covers the whole calendar month', function () {
            $w = $this->world;
            $thisMonth = ['field' => 'due_date', 'op' => 'is', 'value' => 'this_month'];

            expect($w->matches($w->web47, $thisMonth))->toBeTrue()
                ->and($w->matches($w->item(['due_date' => '2026-11-01']), $thisMonth))->toBeFalse()
                ->and($w->matches($w->item(['due_date' => '2026-10-01']), $thisMonth))->toBeTrue();
        });

        it('before and after a range compare against its edges', function () {
            $w = $this->world;
            $beforeThisWeek = ['field' => 'due_date', 'op' => 'before', 'value' => 'this_week'];
            $afterThisWeek = ['field' => 'due_date', 'op' => 'after', 'value' => 'this_week'];

            expect($w->matches($w->item(['due_date' => '2026-10-25']), $beforeThisWeek))->toBeTrue()
                ->and($w->matches($w->web47, $beforeThisWeek))->toBeFalse()
                ->and($w->matches($w->item(['due_date' => '2026-11-02']), $afterThisWeek))->toBeTrue()
                ->and($w->matches($w->item(['due_date' => '2026-11-01']), $afterThisWeek))->toBeFalse()
                ->and($w->matches($w->item(['due_date' => '2026-10-26']), $beforeThisWeek))->toBeFalse();
        });

        it('is_empty and is_not_empty look at the date', function () {
            $w = $this->world;

            expect($w->matches($w->item(), ['field' => 'due_date', 'op' => 'is_empty']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'due_date', 'op' => 'is_not_empty']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'due_date', 'op' => 'is_empty']))->toBeFalse()
                ->and($w->matches($w->ops12, ['field' => 'start_date', 'op' => 'is_empty']))->toBeTrue();
        });

        it('overdue needs a due date and an open item', function () {
            $w = $this->world;

            expect($w->matches($w->item(), ['field' => 'due_date', 'op' => 'overdue']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'due_date', 'op' => 'overdue']))->toBeFalse()
                ->and($w->matches($w->item(['due_date' => '2026-10-28']), ['field' => 'due_date', 'op' => 'overdue']))->toBeFalse()
                ->and($w->matches($w->item(['due_date' => '2026-10-20', 'state' => 'Cancelled']), ['field' => 'due_date', 'op' => 'overdue']))->toBeFalse()
                ->and($w->ids(['field' => 'due_date', 'op' => 'overdue']))->toBe([$w->overdueStarted->id]);
        });

        it('compares timestamps by their day', function () {
            $w = $this->world;

            // web47 was created on 2026-10-20
            expect($w->matches($w->web47, ['field' => 'created_at', 'op' => 'after', 'value' => '2026-10-19']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'created_at', 'op' => 'before', 'value' => '2026-10-20']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'created_at', 'op' => 'is', 'value' => '2026-10-20']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'created_at', 'op' => 'after', 'value' => '2026-10-20']))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'created_at', 'op' => 'before', 'value' => '2026-10-21']))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'closed_at', 'op' => 'is_empty']))->toBeTrue()
                ->and($w->matches($w->overdueDone, ['field' => 'closed_at', 'op' => 'is_not_empty']))->toBeTrue()
                ->and($w->matches($w->overdueDone, ['field' => 'closed_at', 'op' => 'is', 'value' => '2026-10-27']))->toBeTrue();
        });
    });

    describe('timestamps and the time zone', function () {
        // today is 2026-10-28, and Berlin has been on winter time (UTC+1) since 2026-10-25
        $createdToday = ['field' => 'created_at', 'op' => 'is', 'value' => 'today'];

        beforeEach(function () {
            $this->justAfterMidnight = $this->world->item(['created_at' => '2026-10-27 23:30:00']); // 00:30 on the 28th in Berlin
            $this->justAfterNextMidnight = $this->world->item(['created_at' => '2026-10-28 23:30:00']); // 00:30 on the 29th in Berlin
        });

        it('reads the day in the time zone of the context: 00:30 local on the 28th is today', function () use ($createdToday) {
            expect($this->world->matches($this->justAfterMidnight, $createdToday))->toBeTrue();
        });

        it('reads the day in the time zone of the context: 00:30 local on the 29th is not today', function () use ($createdToday) {
            expect($this->world->matches($this->justAfterNextMidnight, $createdToday))->toBeFalse();
        });

        it('counts by the UTC day when the context has no time zone, as before', function () use ($createdToday) {
            Organization::current()->update(['timezone' => 'UTC']);

            expect($this->world->matches($this->justAfterMidnight, $createdToday))->toBeFalse()
                ->and($this->world->matches($this->justAfterNextMidnight, $createdToday))->toBeTrue();
        });

        it('applies to updated_at and closed_at as well', function () {
            $w = $this->world;
            $updated = $w->item(['updated_at' => '2026-10-27 23:30:00']);
            $closed = $w->item(['state' => 'Done', 'closed_at' => '2026-10-27 23:30:00']);
            $updatedToday = ['field' => 'updated_at', 'op' => 'is', 'value' => 'today'];
            $closedToday = ['field' => 'closed_at', 'op' => 'is', 'value' => 'today'];

            expect($w->matches($updated, $updatedToday))->toBeTrue()
                ->and($w->matches($closed, $closedToday))->toBeTrue();

            Organization::current()->update(['timezone' => 'UTC']);

            expect($w->matches($updated, $updatedToday))->toBeFalse()
                ->and($w->matches($closed, $closedToday))->toBeFalse();
        });

        it('turns the day at the right hour in winter time and in summer time', function () use ($createdToday) {
            $w = $this->world;
            $created = fn (string $utc) => $w->item(['created_at' => $utc]);
            $createdOn = fn (string $day) => ['field' => 'created_at', 'op' => 'is', 'value' => $day];

            // winter (UTC+1): the 28th runs from 23:00 to 23:00 UTC
            expect($w->matches($created('2026-10-27 22:59:59'), $createdToday))->toBeFalse()
                ->and($w->matches($created('2026-10-27 23:00:00'), $createdToday))->toBeTrue()
                ->and($w->matches($created('2026-10-28 22:59:59'), $createdToday))->toBeTrue()
                ->and($w->matches($created('2026-10-28 23:00:00'), $createdToday))->toBeFalse();

            // the clocks went back on 2026-10-25: 00:30 summer time, 23:30 winter time, and the next day from 23:00 UTC
            expect($w->matches($created('2026-10-24 21:59:59'), $createdOn('2026-10-25')))->toBeFalse()
                ->and($w->matches($created('2026-10-24 22:30:00'), $createdOn('2026-10-25')))->toBeTrue()
                ->and($w->matches($created('2026-10-25 22:30:00'), $createdOn('2026-10-25')))->toBeTrue()
                ->and($w->matches($created('2026-10-25 23:00:00'), $createdOn('2026-10-25')))->toBeFalse()
                ->and($w->matches($created('2026-10-25 23:00:00'), $createdOn('2026-10-26')))->toBeTrue();

            // they went forward on 2026-03-29: the 29th begins at 23:00 UTC, the 30th at 22:00 UTC
            expect($w->matches($created('2026-03-28 23:30:00'), $createdOn('2026-03-29')))->toBeTrue()
                ->and($w->matches($created('2026-03-28 22:59:59'), $createdOn('2026-03-29')))->toBeFalse()
                ->and($w->matches($created('2026-03-29 21:59:59'), $createdOn('2026-03-29')))->toBeTrue()
                ->and($w->matches($created('2026-03-29 22:30:00'), $createdOn('2026-03-30')))->toBeTrue()
                ->and($w->matches($created('2026-03-29 22:30:00'), $createdOn('2026-03-29')))->toBeFalse();

            // summer (UTC+2): the 15th of July runs from 22:00 to 22:00 UTC
            $this->travelTo(Carbon::parse('2026-07-15 10:00', 'Europe/Berlin'));

            expect($w->matches($created('2026-07-14 21:59:59'), $createdToday))->toBeFalse()
                ->and($w->matches($created('2026-07-14 22:00:00'), $createdToday))->toBeTrue()
                ->and($w->matches($created('2026-07-15 21:59:59'), $createdToday))->toBeTrue()
                ->and($w->matches($created('2026-07-15 22:00:00'), $createdToday))->toBeFalse();
        });

        it('uses the day in the time zone for before, after and between as well', function () {
            $w = $this->world;
            $onThe28th = ['field' => 'created_at', 'op' => 'between', 'value' => ['2026-10-28', '2026-10-28']];

            expect($w->matches($this->justAfterMidnight, ['field' => 'created_at', 'op' => 'before', 'value' => '2026-10-28']))->toBeFalse()
                ->and($w->matches($this->justAfterMidnight, ['field' => 'created_at', 'op' => 'after', 'value' => '2026-10-27']))->toBeTrue()
                ->and($w->matches($this->justAfterNextMidnight, $onThe28th))->toBeFalse()
                ->and($w->matches($this->justAfterMidnight, $onThe28th))->toBeTrue();

            Organization::current()->update(['timezone' => 'UTC']);

            expect($w->matches($this->justAfterNextMidnight, $onThe28th))->toBeTrue();
        });

        it('reads the day of a timestamp in the time zone of the organisation', function () use ($createdToday) {
            $w = $this->world;

            expect($w->matches($w->item(['created_at' => '2026-10-27 23:30:00']), $createdToday))->toBeTrue()
                ->and($w->matches($w->item(['created_at' => '2026-10-27 22:59:00']), $createdToday))->toBeFalse();
        });

        it('counts overdue from midnight of the organisation', function () {
            $w = $this->world;
            $due = $w->item(['due_date' => '2026-10-27', 'state' => 'In Progress']);
            $overdue = ['field' => 'due_date', 'op' => 'overdue'];

            // 00:30 on the 28th in Berlin
            $this->travelTo(Carbon::parse('2026-10-27 23:30', 'UTC'));
            expect($w->matches($due, $overdue))->toBeTrue();

            // 23:30 on the 27th in Berlin
            $this->travelTo(Carbon::parse('2026-10-27 22:30', 'UTC'));
            expect($w->matches($due, $overdue))->toBeFalse();
        });
    });

    describe('flags', function () {
        it('has_children asks the context', function () {
            $w = $this->world;
            $hasChildren = fn (bool $value) => ['field' => 'has_children', 'op' => 'is', 'value' => $value];

            expect($w->matches($w->epicWithoutCustomer, $hasChildren(true)))->toBeTrue()
                ->and($w->matches($w->web47, $hasChildren(true)))->toBeFalse()
                ->and($w->matches($w->web47, $hasChildren(false)))->toBeTrue()
                ->and($w->matches($w->epicWithoutCustomer, $hasChildren(false)))->toBeFalse();
        });

        it('blocked asks the context', function () {
            $w = $this->world;

            expect($w->matches($w->web47, ['field' => 'blocked', 'op' => 'is', 'value' => true]))->toBeTrue()
                ->and($w->matches($w->overdueDone, ['field' => 'blocked', 'op' => 'is', 'value' => true]))->toBeFalse();
        });

        it('blocking asks the context', function () {
            $w = $this->world;
            $blocking = fn (bool $value) => ['field' => 'blocking', 'op' => 'is', 'value' => $value];

            // OPS-12 holds up WEB-47
            expect($w->matches($w->ops12, $blocking(true)))->toBeTrue()
                ->and($w->matches($w->web47, $blocking(true)))->toBeFalse()
                ->and($w->matches($w->web47, $blocking(false)))->toBeTrue()
                ->and($w->matches($w->ops12, $blocking(false)))->toBeFalse();
        });

        it('blocked and blocking do not depend on each other', function () {
            $w = $this->world;
            $blockedAndBlocking = [['field' => 'blocked', 'op' => 'is', 'value' => true], ['field' => 'blocking', 'op' => 'is', 'value' => true]];

            // the middle link of a chain (A blocks B blocks C) is both, the last one only blocked
            $first = $w->item(['state' => 'In Progress']);
            $middle = $w->item(['state' => 'In Progress']);
            $last = $w->item(['state' => 'In Progress']);
            WorkItemRelation::factory()->blocks()->create(['source_id' => $first->id, 'target_id' => $middle->id]);
            WorkItemRelation::factory()->blocks()->create(['source_id' => $middle->id, 'target_id' => $last->id]);

            expect($w->matches($middle, ...$blockedAndBlocking))->toBeTrue()
                ->and($w->matches($last, ...$blockedAndBlocking))->toBeFalse()
                ->and($w->matches($first, ...$blockedAndBlocking))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'blocked', 'op' => 'is', 'value' => true]))->toBeTrue()
                ->and($w->matches($w->ops12, ['field' => 'blocked', 'op' => 'is', 'value' => true]))->toBeFalse()
                ->and($w->ids(...$blockedAndBlocking))->toBe([$middle->id]);
        });

        it('archived looks at archived_at', function () {
            $w = $this->world;
            $archived = $w->item(['state' => 'Done', 'closed_at' => '2026-10-19 00:00:00', 'archived_at' => '2026-10-20 00:00:00']);

            expect($w->matches($archived, ['field' => 'archived', 'op' => 'is', 'value' => true]))->toBeTrue()
                ->and($w->matches($w->web47, ['field' => 'archived', 'op' => 'is', 'value' => true]))->toBeFalse()
                ->and($w->matches($w->web47, ['field' => 'archived', 'op' => 'is', 'value' => false]))->toBeTrue()
                ->and($w->matches($archived, ['field' => 'archived', 'op' => 'is', 'value' => false]))->toBeFalse();
        });

        it('treats is false of a flag as its negation', function () {
            $w = $this->world;
            $all = WorkItem::query()->orderBy('id')->pluck('id')->all();

            foreach (['has_children', 'blocked', 'blocking', 'archived', 'epic', 'subscribed'] as $flag) {
                $yes = $w->ids(['field' => $flag, 'op' => 'is', 'value' => true]);
                $no = $w->ids(['field' => $flag, 'op' => 'is', 'value' => false]);

                expect(array_values(array_diff($all, $yes)))->toBe($no, $flag)
                    ->and(array_intersect($yes, $no))->toBe([], $flag);
            }

            // every item that is not blocked, also those without any relation
            expect($w->ids(['field' => 'blocked', 'op' => 'is', 'value' => false]))
                ->toBe(collect($all)->reject(fn ($id) => $id === $w->web47->id)->values()->all())
                ->toContain($w->epicChild->id);
        });

        it('counts archived children for has_children', function () {
            $w = $this->world;
            $epic = $w->item(['type_id' => $w->epic->id]);
            $w->item(['parent_id' => $epic->id, 'state' => 'Done', 'closed_at' => '2026-10-20 00:00:00', 'archived_at' => '2026-10-21 00:00:00']);

            expect($w->matches($epic, ['field' => 'has_children', 'op' => 'is', 'value' => true]))->toBeTrue();
        });

        it('epic matches the items of types with the epic flag', function () {
            $w = $this->world;

            expect($w->ids(['field' => 'epic', 'op' => 'is', 'value' => true]))->toBe([$w->epicWithoutCustomer->id])
                ->and($w->matches($w->web47, ['field' => 'epic', 'op' => 'is', 'value' => false]))->toBeTrue();

            // the flag counts, not the name
            $w->bug->update(['is_epic' => true]);

            expect($w->ids(['field' => 'epic', 'op' => 'is', 'value' => true]))->toEqualCanonicalizing([$w->epicWithoutCustomer->id, $w->web47->id]);
        });

        it('subscribed matches only what the reader watches and not after unsubscribing', function () {
            $w = $this->world;
            $subscribed = ['field' => 'subscribed', 'op' => 'is', 'value' => true];
            WorkItemSubscriber::query()->create(['work_item_id' => $w->web47->id, 'user_id' => $w->mara->id, 'reason' => 'manual']);
            WorkItemSubscriber::query()->create(['work_item_id' => $w->ops12->id, 'user_id' => $w->jonas->id, 'reason' => 'assigned']);
            $left = WorkItemSubscriber::query()->create(['work_item_id' => $w->overdueStarted->id, 'user_id' => $w->mara->id, 'reason' => 'created']);
            $left->update(['unsubscribed_at' => now()]);

            expect($w->ids($subscribed))->toBe([$w->web47->id])
                ->and($w->matchesFilter($w->ops12, $w->filter($subscribed), $w->jonas))->toBeTrue()
                ->and($w->matchesFilter($w->web47, $w->filter($subscribed), $w->jonas))->toBeFalse()
                ->and($w->matches($w->overdueStarted, ['field' => 'subscribed', 'op' => 'is', 'value' => false]))->toBeTrue();
        });
    });

    describe('title', function () {
        it('contains does not match text that is not in the title', function () {
            expect($this->world->matches($this->world->web47, ['field' => 'title', 'op' => 'contains', 'value' => 'newsletter']))->toBeFalse();
        });

        it('takes percent and underscore literally in title contains', function () {
            $w = $this->world;
            $hundred = $w->item(['title' => 'Ladezeit 100% schneller']);
            $tenfold = $w->item(['title' => 'Ladezeit 1000 schneller']);
            $snake = $w->item(['title' => 'Feld user_id umbenennen']);
            $slash = $w->item(['title' => 'Pfad C:\\temp prüfen']);

            expect($w->ids(['field' => 'title', 'op' => 'contains', 'value' => '100%']))->toBe([$hundred->id])
                ->and($w->ids(['field' => 'title', 'op' => 'contains', 'value' => 'r_i']))->toBe([$snake->id])
                ->and($w->ids(['field' => 'title', 'op' => 'contains', 'value' => 'C:\\t']))->toBe([$slash->id])
                ->and($w->matches($tenfold, ['field' => 'title', 'op' => 'contains', 'value' => '10_0']))->toBeFalse();
        });

        it('finds Über by uber in title contains', function () {
            $w = $this->world;
            $item = $w->item(['title' => 'Über uns überarbeiten']);

            expect($w->ids(['field' => 'title', 'op' => 'contains', 'value' => 'uber uns']))->toBe([$item->id]);
        });
    });

    it('is_not_empty is true for every field of a fully filled item', function () {
        $w = $this->world;
        $full = $w->item([
            'parent_id' => $w->epicWithoutCustomer->id, 'assignee_id' => $w->jonas->id, 'start_date' => '2026-10-01',
            'due_date' => '2026-10-31', 'state' => 'Done', 'closed_at' => '2026-10-27 15:20:00',
        ], [$w->forms]);
        $fields = array_filter(CoreField::cases(), fn (CoreField $field) => in_array(Op::IsNotEmpty, Field::core($field)->ops(), true));

        expect(array_map(fn (CoreField $field) => $field->value, array_values($fields)))
            ->toBe(['assignee', 'parent', 'label', 'start_date', 'due_date', 'closed_at']);
        foreach ($fields as $field) {
            expect($w->matches($full, ['field' => $field->value, 'op' => 'is_not_empty']))->toBeTrue($field->value);
        }
    });
});

it('matches nothing for a condition whose field is gone', function () {
    $w = $this->world;
    $gone = FilterSchema::read(['version' => 1, 'conditions' => [['field' => 'property:gone', 'op' => 'is_empty']]], CatalogProperties::load());

    expect($gone->conditions[0]->resolved)->toBeNull()
        ->and(FilterQuery::apply(WorkItem::query(), $gone, $w->mara)->exists())->toBeFalse()
        // nor does a stored filter of another form, nor an `is_not` that would otherwise match every item
        ->and(FilterQuery::apply(WorkItem::query(), FilterSchema::read(['version' => 2], CatalogProperties::load()), $w->mara)->exists())->toBeFalse()
        ->and(FilterQuery::apply(WorkItem::query(), FilterSchema::read(['version' => 1, 'conditions' => [['field' => 'gone', 'op' => 'is_not', 'value' => 'x']]], CatalogProperties::load()), $w->mara)->exists())->toBeFalse();
});

it('matches nothing for an operator or a value its field does not take', function (CoreField $field, Op $op, mixed $value) {
    // only conditions made by hand get here: the schema offers neither
    $filter = new Filter([new Condition($field->value, $op, $value, Field::core($field))]);

    expect(FilterQuery::apply(WorkItem::query(), $filter, $this->world->mara)->exists())->toBeFalse();
})->with([
    'project before' => [CoreField::Project, Op::Before, 'x'],
    'state_category is_empty' => [CoreField::StateCategory, Op::IsEmpty, null],
    'label before' => [CoreField::Label, Op::Before, 'x'],
    'due_date contains' => [CoreField::DueDate, Op::Contains, '2026'],
    'due_date in' => [CoreField::DueDate, Op::In, ['today']],
    'due_date is a text' => [CoreField::DueDate, Op::Is, 'soon'],
    'due_date before a text' => [CoreField::DueDate, Op::Before, 'soon'],
    'due_date between one day' => [CoreField::DueDate, Op::Between, ['today']],
    'due_date between texts' => [CoreField::DueDate, Op::Between, ['soon', 'later']],
    'created_at after a relative it cannot read' => [CoreField::CreatedAt, Op::After, ['relative' => 'soon']],
    'blocked is_not' => [CoreField::Blocked, Op::IsNot, true],
    'blocked is a word' => [CoreField::Blocked, Op::Is, 'yes'],
    'title is' => [CoreField::Title, Op::Is, 'Kontaktformular sendet doppelt'],
    'title contains a number' => [CoreField::Title, Op::Contains, 47],
]);

it('qualifies every column, so a join does not make it ambiguous', function () {
    $w = $this->world;
    $conditions = [
        ['field' => 'project', 'op' => 'is', 'value' => $w->web->id],
        ['field' => 'state_category', 'op' => 'is', 'value' => 'started'],
        ['field' => 'created_at', 'op' => 'is', 'value' => '2026-10-20'],
        ['field' => 'updated_at', 'op' => 'after', 'value' => '2026-10-01'],
        ['field' => 'archived', 'op' => 'is', 'value' => false],
        ['field' => 'blocked', 'op' => 'is', 'value' => true],
        ['field' => 'title', 'op' => 'contains', 'value' => 'Kontakt'],
    ];
    // projects and workflow_states have `id`, `name`, `created_at`, `updated_at`, `archived_at` as well (ItemOrder joins them)
    $query = WorkItem::query()->select('work_items.*')
        ->join('projects', 'projects.id', '=', 'work_items.project_id')
        ->join('workflow_states', 'workflow_states.id', '=', 'work_items.state_id');

    expect(FilterQuery::apply($query, $w->filter(...$conditions), $w->mara)->pluck('work_items.id')->all())->toBe([$w->web47->id]);
});

it('asks the database a fixed number of times', function () {
    $w = $this->world;
    $value = fn (CoreField $field) => match ($field) {
        CoreField::Project => $w->web->id,
        CoreField::Type => $w->bug->id,
        CoreField::State => $w->state('In Progress'),
        CoreField::Assignee => $w->jonas->id,
        CoreField::CreatedBy => 'me',
        CoreField::Parent => $w->epicWithoutCustomer->id,
        CoreField::StateCategory => 'started',
        CoreField::Priority => 'urgent',
        CoreField::Label => $w->forms->id,
        CoreField::StartDate, CoreField::DueDate, CoreField::CreatedAt, CoreField::UpdatedAt, CoreField::ClosedAt => 'this_month',
        CoreField::Title => 'Kontakt',
        default => true,
    };
    $catalog = CatalogProperties::load();
    $filter = FilterSchema::parse(['version' => 1, 'conditions' => array_map(
        fn (CoreField $field) => ['field' => $field->value, 'op' => Field::core($field)->ops()[0]->value, 'value' => $value($field)],
        CoreField::cases(),
    )], $catalog);
    Organization::current(); // read once per request already (SetLocale)

    DB::enableQueryLog();
    $query = FilterQuery::apply(WorkItem::query(), $filter, $w->mara);
    $before = count(DB::getQueryLog());
    $query->get();
    $after = count(DB::getQueryLog());
    DB::flushQueryLog();
    CatalogProperties::load();
    $catalogQueries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($filter->conditions)->toHaveCount(21)
        ->and($before)->toBe(0)
        ->and($after)->toBe(1)
        ->and($catalogQueries)->toBe(1);
});
