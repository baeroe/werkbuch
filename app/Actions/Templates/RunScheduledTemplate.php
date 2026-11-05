<?php

namespace App\Actions\Templates;

use App\Domain\Schedule\Recurrence;
use App\Models\Organization;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\CatalogLock;
use App\Support\TemplateSchedule;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The scheduler's run of one template (RunTemplateJob, `app:run-templates --now`): the one term that is due after
 * max(`last_run_at`, `schedule_from`) on the calendar of the organisation (after an outage the last one missed, never
 * one before the schedule was set, resumed or its project restored, A339), run through RunTemplate::execute(), which
 * works it out again under its locks. With no term due it only works out `next_run_at` anew, under the shared lock of
 * the organisation (its zone as locked, K3) and the lock of the template, without an event (K23) and without touching
 * `updated_at` (K16). Null when no run happened.
 */
final class RunScheduledTemplate
{
    use AsAction;

    /**
     * @return array{run: TemplateRun, item: ?WorkItem}|null
     */
    public function handle(Actor $actor, string $templateId): ?array
    {
        $template = Template::query()->find($templateId);
        if ($template === null) {
            return null;
        }

        // a first look with the organisation of the job; RunTemplate checks the term again under its locks
        $term = self::due($template, Organization::current());
        $term ??= DB::transaction(function () use ($templateId): ?DateTimeImmutable {
            $organization = CatalogLock::share();
            $current = Template::query()->lockForUpdate()->find($templateId);
            if ($current === null) {
                return null;
            }
            // the zone may have changed meanwhile: a term due on the calendar as locked runs after all
            $term = self::due($current, $organization);
            if ($term === null) {
                $current->timestamps = false;
                $current->forceFill(['next_run_at' => TemplateSchedule::nextRunAt($current->schedule(), TemplateSchedule::since($current), $current->run_count, now()->toDateTimeImmutable(), new DateTimeZone($organization->timezone))])->save();
            }

            return $term;
        }, 3);

        return $term === null ? null : RunTemplate::execute($template, $term, null);
    }

    /** The term due now, or null. */
    private static function due(Template $template, Organization $organization): ?DateTimeImmutable
    {
        $schedule = $template->schedule();

        return $schedule === null ? null : Recurrence::catchUp($schedule, TemplateSchedule::since($template), now()->toDateTimeImmutable(), new DateTimeZone($organization->timezone), $template->run_count);
    }
}
