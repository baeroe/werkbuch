<?php

use App\Actions\Templates\PreviewSchedule;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Validation\ValidationException;

// The preview of a schedule (A335): the next five terms after now on the calendar of the organisation, as the
// scheduler will run them, and the title as the first of them will render it.

beforeEach(function () {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
});

/** The schedule of „Monatsbericht“ (workspace.ts): the first Monday of each month at 09:00. */
$firstMonday = fn (array $changes = []): array => [
    'frequency' => 'monthly', 'interval' => 1, 'nth_weekday' => ['n' => 1, 'weekday' => 1], 'time' => '09:00',
    'starts_on' => '2026-09-01', 'ends' => ['type' => 'never'], 'paused' => false, ...$changes,
];

it('gives the five runs of Monatsbericht', function () use ($firstMonday) {
    // Flow 6: the demo clock, 10:00 in Berlin
    $this->travelTo('2026-10-28 09:00:00');

    $preview = PreviewSchedule::run(actor(User::factory()->create()), ['schedule' => $firstMonday()]);

    expect($preview)->toBe([
        'runs' => [
            '2026-11-02T08:00:00.000000Z',
            '2026-12-07T08:00:00.000000Z',
            '2027-01-04T08:00:00.000000Z',
            '2027-02-01T08:00:00.000000Z',
            '2027-03-01T08:00:00.000000Z',
        ],
        'title' => null,
    ]);
});

it('gives none for a paused schedule', function () use ($firstMonday) {
    $this->travelTo('2026-10-28 09:00:00');

    $preview = PreviewSchedule::run(actor(User::factory()->create()), ['schedule' => $firstMonday(['paused' => true]), 'title' => 'Bericht {month_name}']);

    // without a run the title renders now
    expect($preview)->toBe(['runs' => [], 'title' => 'Bericht Oktober']);
});

it('counts the runs a schedule that ends after some has left', function () use ($firstMonday) {
    $this->travelTo('2026-10-28 09:00:00');

    $preview = PreviewSchedule::run(actor(User::factory()->create()), ['schedule' => $firstMonday(['ends' => ['type' => 'count', 'count' => 4]]), 'run_count' => 2]);

    expect($preview['runs'])->toBe(['2026-11-02T08:00:00.000000Z', '2026-12-07T08:00:00.000000Z']);
});

it('refuses a schedule it cannot read', function () use ($firstMonday) {
    $user = User::factory()->create();
    $errors = fn (array $input) => rescue(fn () => PreviewSchedule::run(actor($user), $input), fn (ValidationException $e) => $e->errors(), false);

    expect($errors(['schedule' => $firstMonday(['time' => '25:00', 'interval' => 0])]))->toBe([
        'schedule.interval' => [__('field.schedule.interval', ['max' => 999])],
        'schedule.time' => [__('field.schedule.time')],
    ])
        ->and($errors([]))->toBe(['schedule' => [__('field.schedule.shape')]])
        ->and($errors(['schedule' => $firstMonday(), 'title' => str_repeat('x', 256), 'run_count' => -1]))->toBe([
            'title' => [__('field.title.max', ['max' => 255])],
            'run_count' => [__('field.run_count.invalid', ['max' => 9999])],
        ])
        ->and($errors(['schedule' => $firstMonday(), 'title' => ['x'], 'run_count' => '2']))->toBe([
            'title' => [__('field.title.invalid')],
            'run_count' => [__('field.run_count.invalid', ['max' => 9999])],
        ]);
});

it('renders the title at the first run', function () use ($firstMonday) {
    // the last Monday of October: the first term is in November, in Berlin as in the title
    $this->travelTo('2026-10-28 09:00:00');

    $preview = PreviewSchedule::run(actor(User::factory()->create()), ['schedule' => $firstMonday(), 'title' => 'Monatsbericht {month_name} {year}']);

    expect($preview['title'])->toBe('Monatsbericht November 2026');
});

it('is a reading POST: a read token may ask it', function () use ($firstMonday) {
    $this->travelTo('2026-10-28 09:00:00');
    $token = apiToken(User::factory()->create(), ['read']);

    $this->withToken($token)->postJson('/api/v1/templates/preview', ['schedule' => $firstMonday(), 'title' => '{month_name}'])
        ->assertOk()
        ->assertJsonPath('data.title', 'November')
        ->assertJsonPath('data.runs.0', '2026-11-02T08:00:00.000000Z')
        ->assertJsonCount(5, 'data.runs');
    $this->withToken($token)->postJson('/api/v1/templates/preview', ['schedule' => null])->assertUnprocessable()->assertJsonValidationErrors('schedule');
});
