<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Actions\WorkItems\CreateWorkItem;
use App\Domain\Schedule\Recurrence;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\MemberInput;
use App\Support\TemplateRunError;
use App\Support\TemplateSchedule;
use Carbon\CarbonImmutable;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Runs a template (spec 4.12): „Jetzt ausführen“ (`POST /api/v1/templates/{template}/run`, `update` at the template:
 * members and admins of its project) and, through execute(), a term of its schedule (Task 8). The item is made by the
 * default bot through `template` (Actor::template(); a run by hand acts for the person who pressed, `meta.on_behalf_of`,
 * K12) with CreateWorkItem: what it reads and copies (the rich text, the pictures of the template, A337) comes before any
 * lock (K1), then the organization shared (its zone and language as locked, K3), the project `for update` and the
 * template `for update` (the order of every template change, so a run waits for a save and the other way round).
 *
 * Under the template lock a run checks that it prepared the template as it is (`updated_at` to the microsecond, K16)
 * and with the zone and language of the organization as they are (K3); otherwise it starts over from the template as
 * saved, at most three times. A term of the schedule is worked out again under the lock (Recurrence::catchUp(): one
 * that is not due any more, done meanwhile by another run, only sets `next_run_at` anew); the run row is unique per
 * term, so a second run of the same term finds it and does nothing (a UniqueConstraintViolationException reads as done).
 *
 * The item is a savepoint: refused (a field of the template that is not valid any more), the run stays `failed` with
 * the sentence of TemplateRunError in the language of the organization and the event `template.run_failed`; the
 * template stays as it is and runs again at its next term. A scheduled run counts (`run_count`), notes its term
 * (`last_run_at`) and works out the next one (`next_run_at`); a run by hand changes none of them (A338), and neither
 * touches `updated_at` (the mark of the version, written by saving alone). The bookkeeping and the run row have no event
 * of their own (K23): the log is `template_runs`.
 */
final class RunTemplate
{
    use AsAction;

    /** How often a run starts over from the saved template (K16). */
    public const ATTEMPTS = 3;

    /**
     * @return array{run: TemplateRun, item: ?WorkItem} the item loaded for its resource (the reader the actor)
     *
     * @throws Problem 403 for viewers, 404 for whom does not see it (or a template deleted meanwhile), 409 `project_archived`
     */
    public function handle(Actor $actor, Template $template): array
    {
        Authorize::check($actor, 'update', $template);

        $ran = self::execute($template, null, $actor->user) ?? throw Problem::notFound();
        if ($ran['item'] !== null) {
            WorkItem::loadForResource($ran['item'], $actor->user);
        }

        return $ran;
    }

    /**
     * A run of the template, without a right: at the term `$scheduledFor` (null: now, by hand, `$trigger` the person
     * who pressed). Null when there was nothing to do: the template or its project gone or being deleted, a scheduled
     * run in an archived project, a term that is not due (any more).
     *
     * @return array{run: TemplateRun, item: ?WorkItem}|null
     *
     * @throws Problem 409 `project_archived` for a run by hand
     */
    public static function execute(Template $template, ?DateTimeImmutable $scheduledFor, ?User $trigger): ?array
    {
        $actor = Actor::template($template);
        $actor = $trigger === null ? $actor : $actor->onBehalfOf($trigger);
        $locale = App::getLocale();
        $organization = Organization::current();

        try {
            for ($attempt = 1; ; $attempt++) {
                $outcome = self::attempt($template->id, $scheduledFor, $trigger, $actor, $organization, $locale);
                if (! $outcome instanceof Organization || $attempt === self::ATTEMPTS) {
                    return $outcome instanceof Organization ? null : $outcome;
                }
                // the template or the organization changed while the run prepared: again, as they are now
                $organization = $outcome;
            }
        } finally {
            App::setLocale($locale);
        }
    }

    /**
     * One try: the organization as locked when the run has to start over.
     *
     * @return array{run: TemplateRun, item: ?WorkItem}|Organization|null
     */
    private static function attempt(string $id, ?DateTimeImmutable $scheduledFor, ?User $trigger, Actor $actor, Organization $organization, string $locale): array|Organization|null
    {
        // the messages of the item, the sentence of the log and the month names of the title: the organization's
        App::setLocale($organization->locale->value);

        $template = Template::query()->find($id);
        if ($template === null) {
            return null;
        }
        $stamp = $template->getRawOriginal('updated_at');
        $input = TemplateRunError::input($template, $scheduledFor ?? now()->toDateTimeImmutable(), $organization);

        try {
            // before any lock: the rich text and the copies of the pictures (K1)
            $prepared = CreateWorkItem::prepare($actor, $input);
        } catch (Problem) {
            // the project is gone or being deleted (the default bot sees every other one)
            return null;
        }

        return DB::transaction(function () use ($id, $scheduledFor, $trigger, $actor, $organization, $locale, $prepared, $stamp): array|Organization|null {
            $locked = CatalogLock::share();
            try {
                $project = MemberInput::lock($prepared['project']);
            } catch (Problem) {
                return null;
            }
            $current = Template::query()->lockForUpdate()->find($id);
            $changed = $locked->timezone !== $organization->timezone || $locked->locale !== $organization->locale;
            if ($current === null || $changed || $current->getRawOriginal('updated_at') !== $stamp) {
                return $current === null ? null : $locked;
            }

            if ($project->archived_at !== null) {
                // the answer of a run by hand is in the language of its account (A151)
                return $scheduledFor === null ? throw Problem::conflict('project_archived', [], __('problem.detail.project_archived', [], $locale)) : null;
            }

            $zone = new DateTimeZone($locked->timezone);
            $now = now()->toDateTimeImmutable();
            if ($scheduledFor !== null) {
                $schedule = $current->schedule();
                $due = $schedule === null ? null : Recurrence::catchUp($schedule, TemplateSchedule::since($current), $now, $zone, $current->run_count);
                if ($due?->getTimestamp() !== $scheduledFor->getTimestamp()) {
                    self::note($current, ['next_run_at' => TemplateSchedule::nextRunAt($schedule, TemplateSchedule::since($current), $current->run_count, $now, $zone)]);

                    return null;
                }
            }

            try {
                $run = TemplateRun::query()->create([
                    'template_id' => $current->id,
                    'scheduled_for' => $scheduledFor,
                    'ran_at' => now(),
                    'status' => TemplateRun::CREATED,
                    'triggered_by' => $trigger?->id,
                ]);
            } catch (UniqueConstraintViolationException) {
                // another run of the term was first
                return null;
            }

            $item = null;
            try {
                $item = CreateWorkItem::insert($actor, $project, $prepared);
                $run->update(['work_item_id' => $item->id]);
            } catch (ValidationException|Problem $refused) {
                $error = TemplateRunError::text($refused, $current->payload);
                $run->update(['status' => TemplateRun::FAILED, 'error' => $error]);
                EventRecorder::record(EventType::TemplateRunFailed, $actor, $current, $project, null, [
                    'run_id' => $run->id,
                    'error' => $error,
                    'scheduled_for' => $scheduledFor === null ? null : CarbonImmutable::instance($scheduledFor)->utc()->toJSON(),
                    'author_id' => $current->created_by,
                ]);
            }

            if ($scheduledFor !== null) {
                $count = $current->run_count + 1;
                // the term is after `schedule_from` (catchUp() gives none before it): from now on it is `since`
                self::note($current, [
                    'last_run_at' => $scheduledFor,
                    'run_count' => $count,
                    'next_run_at' => TemplateSchedule::nextRunAt($current->schedule(), $scheduledFor, $count, $now, $zone),
                ]);
            }

            return ['run' => $run, 'item' => $item];
        }, 3);
    }

    /**
     * The bookkeeping of the schedule, without touching `updated_at` (the mark of the version a run prepares, K16).
     *
     * @param  array<string, mixed>  $columns
     */
    private static function note(Template $template, array $columns): void
    {
        $template->timestamps = false;
        $template->forceFill($columns)->save();
        $template->timestamps = true;
    }
}
