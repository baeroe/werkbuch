<?php

namespace App\Actions\Templates;

use App\Domain\Schedule\Recurrence;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\ProjectLock;
use App\Support\TemplateSchedule;
use Carbon\CarbonImmutable;
use DateTimeZone;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The term of a template whose run kept crashing (RunTemplateJob::failed(), after its last try; an exception that is no
 * refusal of a field, T8-M2): booked as a failed run like a template that is not valid any more, with a sentence in the
 * language of the organisation (never the message of the exception) and `template.run_failed`, so lead and author hear
 * of it and the sweeper moves on to the next term instead of queueing the same one again every five minutes. Locks like
 * RunTemplate (organisation shared, project, template) and works the term out again: nothing when none is due (done
 * meanwhile, paused, the template or its project gone, archived or being deleted); a run of the term that is already
 * there is noted as done without a second one. Null when it booked no run.
 */
final class FailScheduledTemplate
{
    use AsAction;

    public function handle(Actor $actor, string $templateId): ?TemplateRun
    {
        $template = Template::query()->with('project')->find($templateId);
        if ($template === null) {
            return null;
        }

        return DB::transaction(function () use ($template): ?TemplateRun {
            $organization = CatalogLock::share();
            try {
                $project = ProjectLock::lock($template->project);
            } catch (Problem) {
                return null;
            }
            $current = Template::query()->lockForUpdate()->find($template->id);
            $schedule = $current?->schedule();
            if ($current === null || $schedule === null || $project->archived_at !== null) {
                return null;
            }

            $zone = new DateTimeZone($organization->timezone);
            $now = now()->toDateTimeImmutable();
            $term = Recurrence::catchUp($schedule, TemplateSchedule::since($current), $now, $zone, $current->run_count);
            if ($term === null) {
                return null;
            }
            $term = $term->setTimezone(new DateTimeZone('UTC'));

            $error = __('templates.run.crashed', [], $organization->locale->value);
            try {
                $run = TemplateRun::query()->create([
                    'template_id' => $current->id,
                    'scheduled_for' => $term,
                    'ran_at' => now(),
                    'status' => TemplateRun::FAILED,
                    'error' => $error,
                ]);
            } catch (UniqueConstraintViolationException) {
                // a run of the term is there: the term is done, only its bookkeeping may be missing
                self::note($current, ['last_run_at' => $term, 'next_run_at' => TemplateSchedule::nextRunAt($schedule, $term, $current->run_count, $now, $zone)]);

                return null;
            }

            EventRecorder::record(EventType::TemplateRunFailed, Actor::template($current), $current, $project, null, [
                'run_id' => $run->id,
                'error' => $error,
                'scheduled_for' => CarbonImmutable::instance($term)->utc()->toJSON(),
                'author_id' => $current->created_by,
            ]);
            $count = $current->run_count + 1;
            self::note($current, ['last_run_at' => $term, 'run_count' => $count, 'next_run_at' => TemplateSchedule::nextRunAt($schedule, $term, $count, $now, $zone)]);

            return $run;
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
    }
}
