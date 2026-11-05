<?php

use App\Access\ProjectRole;
use App\Actions\Templates\DraftFromTemplate;
use App\Domain\Properties\FieldType;
use App\Http\Resources\TemplateDraftResource;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItemType;
use Illuminate\Http\Request;
use Tests\Support\RichTextFixtures as F;

// The draft of a template (A335): the fields of an item as it would be made from the template now, its title rendered
// and its dates counted from today, both on the calendar and in the language of the organisation.

/** WEB with Mara as its admin, Lene as a viewer, and a template of Mara. */
$world = function (array $payload = []): array {
    Organization::current()->update(['timezone' => 'Europe/Berlin', 'locale' => 'de']);
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $lene = memberOf($web, ProjectRole::Viewer);
    $template = Template::factory()->create(['project_id' => $web->id, 'created_by' => $mara->id]);
    $template->update(['payload' => [...$template->payload, ...$payload]]);

    return [$web, $mara, $lene, $template];
};

it('fills the title and the dates of today in the zone of the organisation', function () use ($world) {
    [$web, $mara, , $template] = $world(['title' => 'Bericht {date}', 'start_offset_days' => 0, 'due_offset_days' => 2, 'priority' => 'high']);
    // still the 31st in UTC, already the 1st of November in Berlin
    $this->travelTo('2026-10-31 23:30:00');

    $draft = DraftFromTemplate::run(actor($mara), $template);

    expect($draft)->toMatchArray([
        'project_id' => $web->id,
        'template_id' => $template->id,
        'type_id' => $web->default_type_id,
        'title' => 'Bericht 2026-11-01',
        'priority' => 'high',
        'start_date' => '2026-11-01',
        'due_date' => '2026-11-03',
        'parent_id' => null,
        'assignee_id' => null,
    ]);
});

it('names the month in the language of the organisation', function () use ($world) {
    [, $mara, , $template] = $world(['title' => '{month_name} {year}']);
    $title = fn () => DraftFromTemplate::run(actor($mara), $template)['title'];

    $this->travelTo('2026-11-02 09:00:00');
    $german = $title();
    Organization::current()->update(['locale' => 'en']);
    $english = $title();
    Organization::current()->update(['locale' => 'de']);
    $this->travelTo('2027-03-01 09:00:00');

    expect([$german, $english, $title()])->toBe(['November 2026', 'November 2026', 'März 2027']);
});

it('answers 403 to a viewer, 404 to someone who does not see the project', function () use ($world) {
    [, , $lene, $template] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = Template::factory()->create(['project_id' => $ops->id]);

    $denied = problemOf(fn () => DraftFromTemplate::run(actor($lene), $template));

    expect([$denied->status, $denied->detail])->toBe([403, __('problem.detail.items_members_only')])
        ->and(problemOf(fn () => DraftFromTemplate::run(actor($lene), $hidden))->status)->toBe(404);
});

it('leaves out labels that are gone and values of keys the type has no more (A340)', function () use ($world) {
    $kept = Label::factory()->create(['name' => 'Bleibt']);
    $gone = Label::factory()->create(['name' => 'Weg']);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $customer = Property::factory()->create(['key' => 'customer', 'label' => 'Kunde', 'field_type' => FieldType::Text]);
    $task->typeProperties()->create(['property_id' => $customer->id, 'required' => false, 'position' => 9]);
    $other = Property::factory()->create(['key' => 'old', 'label' => 'Alt', 'field_type' => FieldType::Text]);
    [, $mara, , $template] = $world([
        'type_id' => $task->id,
        'label_ids' => [$gone->id, $kept->id],
        'values' => ['customer' => 'Feldwerk', 'old' => 'weg'],
    ]);
    $gone->delete();
    $other->delete();

    $draft = DraftFromTemplate::run(actor($mara), $template);

    expect($draft['label_ids'])->toBe([$kept->id])
        ->and($draft['values'])->toBe(['customer' => 'Feldwerk']);
});

it('gives the description with the ids of the template\'s pictures and as Markdown for the reader', function () use ($world) {
    [, $mara, , $template] = $world();
    $doc = F::doc(F::p(F::text('Siehe '), F::mention($mara->id, 'mara')), F::image(F::IMAGE, 'Bild'));
    $template->update(['payload' => [...$template->payload, 'description' => $doc]]);

    $draft = DraftFromTemplate::run(actor($mara), $template);
    $json = (new TemplateDraftResource($draft))->toArray(Request::create('/'));

    expect($json['description_json'])->toBe($doc)
        ->and($json['description'])->toBe("Siehe @mara\n\n![Bild](attachment:".F::IMAGE.')')
        ->and($json['values'])->toEqual((object) [])
        ->and(array_keys($json))->toBe(['project_id', 'template_id', 'type_id', 'title', 'description', 'description_json', 'priority', 'assignee_id', 'label_ids', 'values', 'parent_id', 'start_date', 'due_date']);
});
