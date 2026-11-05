<?php

use App\Domain\Properties\FieldType;
use App\Exceptions\Problem;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\Template;
use App\Models\WorkItemType;
use App\Support\TemplateRunError;
use Illuminate\Validation\ValidationException;
use Tests\Support\RichTextFixtures as F;

// The sentence of a failed run (port of failureText) and the input a run hands CreateWorkItem (A340).

it('names the missing required properties in the order of the type', function () {
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    foreach ([['host', 'Host', 30], ['env', 'Umgebung', 10], ['customer', 'Kunde', 20]] as [$key, $label, $position]) {
        $property = Property::factory()->create(['key' => $key, 'label' => $label, 'field_type' => FieldType::Text]);
        $task->typeProperties()->create(['property_id' => $property->id, 'required' => true, 'position' => $position]);
    }
    $missing = fn (string ...$labels) => ValidationException::withMessages(array_combine(
        array_map(fn (string $label) => 'values.'.['Host' => 'host', 'Umgebung' => 'env', 'Kunde' => 'customer'][$label], $labels),
        array_map(fn (string $label) => __('field.values.required', ['label' => $label]), $labels),
    ));
    $payload = ['type_id' => $task->id];

    expect(TemplateRunError::text($missing('Host', 'Umgebung'), $payload))->toBe(__('templates.run.required_missing.other', ['properties' => 'Umgebung '.__('templates.run.and').' Host']))
        ->and(TemplateRunError::text($missing('Kunde'), $payload))->toBe(__('templates.run.required_missing.one', ['properties' => 'Kunde']))
        // another error at a value is no missing property
        ->and(TemplateRunError::text(ValidationException::withMessages(['values.env' => 'Keine Zahl']), $payload))->toBe('Keine Zahl');
});

it('says the first message of a field, the detail of a problem or the sentence of its reason', function () {
    expect(TemplateRunError::text(ValidationException::withMessages(['title' => ['Zu lang', 'Auch'], 'type_id' => 'Weg']), []))->toBe('Zu lang')
        ->and(TemplateRunError::text(Problem::unprocessable('parent_not_epic', ['parent_id' => [__('problem.reason.parent_not_epic')]]), []))->toBe(__('problem.reason.parent_not_epic'))
        ->and(TemplateRunError::text(Problem::conflict('transition_not_allowed', [], 'Kein Weg dorthin'), []))->toBe('Kein Weg dorthin')
        ->and(TemplateRunError::text(Problem::conflict('project_archived'), []))->toBe(__('problem.reason.project_archived'))
        ->and(TemplateRunError::text(new ValidationException(validator([], [])), []))->toBe('The given data was invalid.');
});

it('hands CreateWorkItem the fields of the template at the moment of the run', function () {
    Organization::current()->update(['timezone' => 'Pacific/Auckland', 'locale' => 'en']);
    $web = Project::factory()->create();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $template->update(['payload' => [...$template->payload, 'title' => '{month_name} {date}', 'description' => F::doc(F::p(F::text('Plan'))), 'due_offset_days' => 2]]);

    // 2026-12-31 12:00 UTC is already 2027-01-01 in Auckland
    $input = TemplateRunError::input($template, new DateTimeImmutable('2026-12-31 12:00:00+00:00'), Organization::current());

    expect($input)->toMatchArray([
        'project_id' => $web->id, 'template_id' => $template->id, 'title' => 'January 2027-01-01', 'due_date' => '2027-01-03',
        'description_json' => F::doc(F::p(F::text('Plan'))),
    ])->and($input)->not->toHaveKey('description');
});
