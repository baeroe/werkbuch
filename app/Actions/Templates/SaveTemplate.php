<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Domain\Schedule\Schedule;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\Template;
use App\Support\Actor;
use App\Support\AttachmentLinks;
use App\Support\CatalogInput;
use App\Support\CatalogLock;
use App\Support\ItemLock;
use App\Support\MemberInput;
use App\Support\TemplateInput;
use App\Support\TemplateSchedule;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Creates a template in a project (`POST /api/v1/projects/{project}/templates`) or replaces one as a whole
 * (`PUT /api/v1/templates/{template}`, A75): members and admins of the project (`template.manage`). The rich text of the
 * payload is read before any lock (TemplateInput::documents(), it may take a second); then the organization (shared, its
 * zone and language as locked, K3), the project (`for update`; being deleted 404, archived 409, spec 4.4) and the
 * template read afresh (gone meanwhile: 404), and under them every other field (TemplateInput::validate(), all errors in
 * one 422). The writer's uploads its texts name become the template's (AttachmentLinks).
 *
 * The schedule counts from the moment it is set (A339): a new one, one that changes in its normal form (a pause and a
 * resume included) sets `schedule_from` to now and works out `next_run_at` afresh; a term before that moment is never
 * caught up. A change of anything else keeps both. `template.created` with the name; `template.updated` with the
 * changes of `name`, `payload` and `schedule`, only when something really changes (the same input again, its own answer
 * included, writes nothing and keeps `updated_at`). The creator stays.
 */
final class SaveTemplate
{
    use AsAction;

    /**
     * @param  array<array-key, mixed>  $input  `name`, `payload`, `schedule`
     *
     * @throws ValidationException
     * @throws Problem
     */
    public function handle(Actor $actor, Project|string|null $project, array $input, ?Template $template = null): Template
    {
        if ($template !== null) {
            Authorize::check($actor, 'update', $template);
            $project = $template->project;
        } else {
            $project = is_string($project) ? Project::findByReference($project) : $project;
            $project ?? throw Problem::notFound();
            Authorize::check($actor, 'create', Template::class, $project);
        }

        // reading Markdown is the expensive step: never under a lock
        [$input, $refused, $texts] = TemplateInput::documents($input, $project, $actor->user, $template);

        $saved = DB::transaction(function () use ($actor, $project, $input, $template, $refused, $texts): Template {
            $organization = CatalogLock::share();
            $locked = MemberInput::lock($project);
            ItemLock::refuseArchivedProject($locked);
            $current = $template === null ? null : (Template::query()->lockForUpdate()->find($template->id) ?? throw Problem::notFound());

            $zone = new DateTimeZone($organization->timezone);
            $valid = TemplateInput::validate($input, $locked, $actor->user, $current, $zone, $organization->locale->value, $refused, $texts);
            $columns = ['name' => $valid['name'], 'payload' => $valid['payload'], 'schedule' => $valid['schedule']?->toArray()];
            $now = now()->toImmutable();

            if ($current === null) {
                $created = Template::query()->create([
                    ...$columns,
                    ...self::timing($valid['schedule'], 0, $now, $zone),
                    'project_id' => $locked->id,
                    'run_count' => 0,
                    'created_by' => $actor->user->id,
                ]);
                AttachmentLinks::link($created, $locked, $actor->user, $valid['documents']);
                EventRecorder::record(EventType::TemplateCreated, $actor, $created, $locked, ['name' => ['old' => null, 'new' => $created->name]]);

                return $created;
            }

            $changes = CatalogInput::changes(['name' => $current->name, 'payload' => $current->payload, 'schedule' => $current->schedule], $columns);
            if ($changes !== []) {
                $timing = array_key_exists('schedule', $changes) ? self::timing($valid['schedule'], $current->run_count, $now, $zone) : [];
                $current->fill([...$columns, ...$timing])->save();
                EventRecorder::record(EventType::TemplateUpdated, $actor, $current, $locked, $changes);
            }
            AttachmentLinks::link($current, $locked, $actor->user, $valid['documents']);

            return $current;
        }, 3);

        Template::loadForResource($saved, $actor->user);

        return $saved;
    }

    /**
     * A schedule that is set now counts from now (A339): `schedule_from` now and `next_run_at` the first term after it
     * on the calendar of the organisation; without a schedule both are empty.
     *
     * @return array{schedule_from: ?DateTimeImmutable, next_run_at: ?DateTimeImmutable}
     */
    private static function timing(?Schedule $schedule, int $runCount, DateTimeImmutable $now, DateTimeZone $zone): array
    {
        return [
            'schedule_from' => $schedule === null ? null : $now,
            'next_run_at' => TemplateSchedule::nextRunAt($schedule, $now, $runCount, $now, $zone),
        ];
    }
}
