<?php

namespace App\Actions\Templates;

use App\Domain\Filter\InvalidInput;
use App\Domain\Schedule\Placeholders;
use App\Domain\Schedule\Recurrence;
use App\Domain\Schedule\Schedule;
use App\Models\Organization;
use App\Support\Actor;
use App\Support\ItemInput;
use App\Support\TemplateInput;
use App\Support\TemplateSchedule;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The preview of a schedule (`POST /api/v1/templates/preview`, a reading POST, A335): the next five terms after now on
 * the calendar of the organisation, as the scheduler will run them, and a title as the first of them will render it (in
 * the language of the organisation; without a term, as now). Only the server counts terms, so the editor shows exactly
 * what will happen. Any active account may ask; nothing is read but the organisation.
 */
final class PreviewSchedule
{
    use AsAction;

    /** How many terms the preview shows (spec 4.12). */
    public const RUNS = 5;

    /**
     * @param  array<array-key, mixed>  $input  `schedule` (required, as a template takes it), `title` (optional, up to 255 characters), `run_count` (optional, 0–9999: the runs a schedule that ends after some has had)
     * @return array{runs: list<string>, title: ?string}
     *
     * @throws ValidationException
     */
    public function handle(Actor $actor, array $input): array
    {
        $errors = [];

        $schedule = null;
        try {
            $schedule = Schedule::parse($input['schedule'] ?? null);
        } catch (InvalidInput $invalid) {
            foreach ($invalid->errorsAt('schedule') as $path => $code) {
                $errors[$path] = [TemplateInput::scheduleMessage($path, $code)];
            }
        }

        $title = $input['title'] ?? null;
        if ($title !== null && ! is_string($title)) {
            $errors['title'] = [__('field.title.invalid')];
        } elseif (is_string($title) && mb_strlen($title) > ItemInput::TITLE_MAX) {
            $errors['title'] = [__('field.title.max', ['max' => ItemInput::TITLE_MAX])];
        }

        $runCount = $input['run_count'] ?? 0;
        if (! is_int($runCount) || $runCount < 0 || $runCount > Schedule::MAX_COUNT) {
            $errors['run_count'] = [__('field.run_count.invalid', ['max' => Schedule::MAX_COUNT])];
        }

        if ($errors !== [] || $schedule === null || ! is_int($runCount)) {
            throw ValidationException::withMessages($errors);
        }

        $organization = Organization::current();
        $zone = new DateTimeZone($organization->timezone);
        $now = now()->toDateTimeImmutable();
        $runs = Recurrence::next($schedule, $now, self::RUNS, $zone, $runCount);

        return [
            'runs' => array_map(fn (DateTimeImmutable $run) => CarbonImmutable::instance($run)->toJSON(), $runs),
            'title' => is_string($title)
                ? Placeholders::render($title, $runs[0] ?? $now, $zone, TemplateSchedule::monthNames($organization->locale->value))
                : null,
        ];
    }
}
