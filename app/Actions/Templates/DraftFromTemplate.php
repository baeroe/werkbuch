<?php

namespace App\Actions\Templates;

use App\Access\Authorize;
use App\Domain\Schedule\Offsets;
use App\Domain\Schedule\Placeholders;
use App\Domain\Time\OrgCalendar;
use App\Exceptions\Problem;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Property;
use App\Models\Template;
use App\Models\TypeProperty;
use App\Models\WorkItem;
use App\Support\Actor;
use App\Support\ReaderNames;
use App\Support\TemplateInput;
use App\Support\TemplateSchedule;
use App\Views\Calendar;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The draft of an item from a template (`GET /api/v1/templates/{template}/draft`, A335): the fields an item would get
 * from it now, for the create dialog to fill in and send with `template_id`. Whoever sees the template and may create
 * items in its project (a viewer gets the 403 of creating, someone who does not see the project a 404). The title has
 * its placeholders filled for now and the dates their offsets counted from today, both on the calendar and in the
 * language of the organisation; the description names the template's own pictures (CreateWorkItem copies them, A337).
 * Labels that are gone and values of keys the type has no more fall away (A340).
 */
final class DraftFromTemplate
{
    use AsAction;

    /**
     * @return array<string, mixed> the fields of input() and `rich_names` (what the reader may see of the texts)
     *
     * @throws Problem
     */
    public function handle(Actor $actor, Template $template): array
    {
        Authorize::check($actor, 'view', $template);
        Authorize::check($actor, 'create', WorkItem::class, $template->project);

        $draft = self::input($template, Calendar::current(), Organization::current()->locale->value);
        $texts = array_values(array_filter([$draft['description'], ...array_values($draft['values'])], TemplateInput::isDoc(...)));

        return [...$draft, 'rich_names' => ReaderNames::of($texts, $actor->user)];
    }

    /**
     * The input of CreateWorkItem for an item made from the template at the moment and on the day of `$calendar` (its
     * `now` and `today()`), the month names of a title in `$locale`: `project_id`, `template_id`, `type_id`, `title`,
     * `description` (Tiptap JSON or null), `priority`, `assignee_id`, `label_ids` (without those that are gone),
     * `values` (without keys the type has no more), `parent_id`, `start_date`, `due_date`.
     *
     * @return array{project_id: string, template_id: string, type_id: ?string, title: string, description: ?array<string, mixed>, priority: string, assignee_id: ?string, label_ids: list<string>, values: array<string, mixed>, parent_id: ?string, start_date: ?string, due_date: ?string}
     */
    public static function input(Template $template, OrgCalendar $calendar, string $locale): array
    {
        $payload = $template->payload;
        $typeId = is_string($payload['type_id'] ?? null) ? $payload['type_id'] : null;
        $description = TemplateInput::isDoc($payload['description'] ?? null) ? $payload['description'] : null;
        $start = $payload['start_offset_days'] ?? null;
        $due = $payload['due_offset_days'] ?? null;

        $labels = array_values(array_filter((array) ($payload['label_ids'] ?? []), is_string(...)));
        $kept = $labels === [] ? [] : Label::query()->whereKey($labels)->pluck('id')->all();

        $values = (array) ($payload['values'] ?? []);
        $known = $values === [] ? [] : Property::query()->whereIn('id', TypeProperty::query()->where('type_id', $typeId)->select('property_id'))->pluck('key')->all();

        return [
            'project_id' => $template->project_id,
            'template_id' => $template->id,
            'type_id' => $typeId,
            'title' => Placeholders::render((string) ($payload['title'] ?? ''), $calendar->now, $calendar->zone, TemplateSchedule::monthNames($locale)),
            'description' => $description,
            'priority' => is_string($payload['priority'] ?? null) ? $payload['priority'] : 'none',
            'assignee_id' => is_string($payload['assignee_id'] ?? null) ? $payload['assignee_id'] : null,
            'label_ids' => array_values(array_filter($labels, fn (string $id) => in_array($id, $kept, true))),
            'values' => array_intersect_key($values, array_flip($known)),
            'parent_id' => is_string($payload['parent_id'] ?? null) ? $payload['parent_id'] : null,
            'start_date' => Offsets::day($calendar->today(), is_int($start) ? $start : null),
            'due_date' => Offsets::day($calendar->today(), is_int($due) ? $due : null),
        ];
    }
}
