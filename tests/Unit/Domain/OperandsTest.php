<?php

use App\Domain\Filter\DayRange;
use App\Domain\Filter\Field;
use App\Domain\Filter\Operands;
use App\Domain\Filter\Scalar;
use App\Domain\Time\OrgCalendar;
use Tests\Support\FixedPropertyCatalog;

$me = '01jbz8v6w2k7c0m9x4r5t3n8qa';

/** Today is Wednesday, 2026-10-28, in Berlin (10:00 local time). */
$calendar = fn (int $weekStart = 1): OrgCalendar => new OrgCalendar(new DateTimeZone('Europe/Berlin'), $weekStart, new DateTimeImmutable('2026-10-28T09:00:00Z'));

$field = fn (string $name): Field => Field::named($name, new FixedPropertyCatalog) ?? throw new LogicException($name);

it('turns a dynamic value into what a condition compares against', function (string $name, mixed $value, int $weekStart, mixed $expected) use ($me, $calendar, $field) {
    expect(Operands::one($value, $field($name), $me, $calendar($weekStart)))->toEqual($expected);
})->with([
    'today' => ['due_date', 'today', 1, new DayRange('2026-10-28', '2026-10-28')],
    'this week from monday' => ['due_date', 'this_week', 1, new DayRange('2026-10-26', '2026-11-01')],
    'this week from sunday' => ['due_date', 'this_week', 0, new DayRange('2026-10-25', '2026-10-31')],
    'this month' => ['due_date', 'this_month', 1, new DayRange('2026-10-01', '2026-10-31')],
    'two weeks ago' => ['due_date', ['relative' => '-2w'], 1, new DayRange('2026-10-14', '2026-10-14')],
    'in a week' => ['start_date', ['relative' => '+7d'], 1, new DayRange('2026-11-04', '2026-11-04')],
    'in three days without a sign' => ['due_date', ['relative' => '3d'], 1, new DayRange('2026-10-31', '2026-10-31')],
    'zero days is today' => ['due_date', ['relative' => '0d'], 1, new DayRange('2026-10-28', '2026-10-28')],
    'a day' => ['due_date', '2026-10-31', 1, new DayRange('2026-10-31', '2026-10-31')],
    'today on a timestamp' => ['created_at', 'today', 1, new DayRange('2026-10-28', '2026-10-28')],
    'a day of a date property' => ['property:launch', '2026-12-01', 1, new DayRange('2026-12-01', '2026-12-01')],
    'relative on a date property' => ['property:launch', ['relative' => '+1w'], 1, new DayRange('2026-11-04', '2026-11-04')],
    'a day with a line break stays text' => ['due_date', "2026-10-31\n", 1, new Scalar("2026-10-31\n")],
    'no calendar day stays text' => ['due_date', '2026-02-30', 1, new Scalar('2026-02-30')],
    'me as assignee' => ['assignee', 'me', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qa')],
    'me as creator' => ['created_by', 'me', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qa')],
    'me in a person property' => ['property:reviewer', 'me', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qa')],
    'me among several people' => ['property:reviewers', 'me', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qa')],
    'a number' => ['property:effort', 3.5, 1, new Scalar(3.5)],
    'a whole number' => ['property:effort', 7, 1, new Scalar(7)],
    'a boolean' => ['archived', false, 1, new Scalar(false)],
    'a category' => ['state_category', 'started', 1, new Scalar('started')],
    'a ULID' => ['project', '01jbz8v6w2k7c0m9x4r5t3n8qb', 1, new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qb')],
]);

it('leaves dynamic words alone where the field does not take them', function (string $name, mixed $value) use ($me, $calendar, $field) {
    expect(Operands::one($value, $field($name), $me, $calendar()))->toEqual(new Scalar($value));
})->with([
    'me in the title' => ['title', 'me'],
    'me in a text property' => ['property:browser', 'me'],
    'me in rich text' => ['property:notes', 'me'],
    'me as a project' => ['project', 'me'],
    'me as an option' => ['property:customer', 'me'],
    'me as a day' => ['due_date', 'me'],
    'today in a text property' => ['property:browser', 'today'],
    'this week in the title' => ['title', 'this_week'],
    'this month in an address' => ['property:link', 'this_month'],
    'a day in a text property' => ['property:browser', '2026-10-01'],
    'a day in the title' => ['title', '2026-10-01'],
    'a day as an option' => ['property:customer', '2026-10-01'],
    'some text on a day' => ['due_date', 'tomorrow'],
]);

it('gives nothing for a value it cannot read', function (string $name, mixed $value) use ($me, $calendar, $field) {
    expect(Operands::one($value, $field($name), $me, $calendar()))->toBeNull();
})->with([
    'months are no unit' => ['due_date', ['relative' => '+7m']],
    'six digits' => ['due_date', ['relative' => '+100000d']],
    'relative without text' => ['due_date', ['relative' => 7]],
    'an object without relative' => ['due_date', ['days' => 7]],
    'relative on a text' => ['property:browser', ['relative' => '+7d']],
    'null' => ['due_date', null],
]);

it('reads one value as a list of one and leaves out what it cannot read', function () use ($me, $calendar, $field) {
    expect(Operands::of('today', $field('due_date'), $me, $calendar()))->toEqual([new DayRange('2026-10-28', '2026-10-28')])
        ->and(Operands::of(['me', '01jbz8v6w2k7c0m9x4r5t3n8qb', ['relative' => '+7d']], $field('assignee'), $me, $calendar()))
        ->toEqual([new Scalar($me), new Scalar('01jbz8v6w2k7c0m9x4r5t3n8qb')])
        ->and(Operands::of(['relative' => '+1w'], $field('due_date'), $me, $calendar()))->toEqual([new DayRange('2026-11-04', '2026-11-04')])
        ->and(Operands::of(['2026-10-01', '2026-10-01'], $field('due_date'), $me, $calendar()))
        ->toEqual([new DayRange('2026-10-01', '2026-10-01'), new DayRange('2026-10-01', '2026-10-01')])
        ->and(Operands::of(null, $field('due_date'), $me, $calendar()))->toBe([])
        ->and(Operands::of([], $field('due_date'), $me, $calendar()))->toBe([]);
});
