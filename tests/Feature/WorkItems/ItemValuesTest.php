<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Domain\Properties\FieldType;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use App\Models\WorkItemValue;
use App\RichText\Document;
use App\RichText\MarkdownContext;
use App\RichText\Schema;
use App\Support\ItemValues;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures;

/**
 * A type with one property per field type (none required), in a project with Lene as a member. Dropdowns: `size` (one
 * of S, M, L) and `tags` (several of A, B, C).
 */
$world = function (): array {
    $project = Project::factory()->create();
    $lene = memberOf($project, ProjectRole::Member, ['name' => 'Lene']);
    $type = WorkItemType::factory()->create(['name' => 'Anfrage']);
    $properties = [
        'note' => Property::factory()->create(['key' => 'note', 'label' => 'Notiz']),
        'hours' => Property::factory()->create(['key' => 'hours', 'label' => 'Stunden', 'field_type' => FieldType::Number, 'settings' => ['decimals' => 1]]),
        'count' => Property::factory()->create(['key' => 'count', 'label' => 'Anzahl', 'field_type' => FieldType::Number, 'settings' => ['decimals' => 0]]),
        'size' => Property::factory()->dropdown(['S', 'M', 'L'])->create(['key' => 'size', 'label' => 'Größe']),
        'tags' => Property::factory()->dropdown(['A', 'B', 'C'], multiple: true)->create(['key' => 'tags', 'label' => 'Tags']),
        'paid' => Property::factory()->create(['key' => 'paid', 'label' => 'Bezahlt', 'field_type' => FieldType::Boolean]),
        'due' => Property::factory()->create(['key' => 'due', 'label' => 'Frist', 'field_type' => FieldType::Date]),
        'link' => Property::factory()->create(['key' => 'link', 'label' => 'Link', 'field_type' => FieldType::Url]),
        'owner' => Property::factory()->create(['key' => 'owner', 'label' => 'Owner', 'field_type' => FieldType::Member, 'settings' => ['multiple' => false]]),
        'team' => Property::factory()->create(['key' => 'team', 'label' => 'Team', 'field_type' => FieldType::Member, 'settings' => ['multiple' => true]]),
        'notes' => Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]),
    ];
    foreach (array_values($properties) as $position => $property) {
        $type->typeProperties()->create(['property_id' => $property->id, 'required' => false, 'position' => $position]);
    }

    return [$project, $type, $properties, $lene];
};

/** The ids of the options of a dropdown, in their order. */
$options = fn (Property $property): array => $property->options()->pluck('id')->all();

it('takes a valid value of every field type and refuses an invalid one at its key, with its label', function () use ($world, $options) {
    [$project, $type, $properties, $lene] = $world();
    [$s] = $options($properties['size']);
    [$a, $b] = $options($properties['tags']);
    $check = fn (array $input) => ItemValues::check($project, $type, $input, [], 'create');

    expect($check([
        'note' => '  Rückruf  ',
        'hours' => '3,46',
        'count' => '3,46',
        'size' => strtoupper($s),
        'tags' => [$b, strtoupper($a), $b],
        'paid' => false,
        'due' => '2026-10-31',
        'link' => ' https://example.com/straße ',
        'owner' => strtoupper($lene->id),
        'team' => [$lene->id],
        'notes' => '**Wichtig**',
    ]))->toBe([
        'note' => 'Rückruf',
        'hours' => 3.5,
        'count' => 3,
        'size' => $s,
        'tags' => [$b, $a],
        'paid' => false,
        'due' => '2026-10-31',
        'link' => 'https://example.com/straße',
        'owner' => $lene->id,
        'team' => [$lene->id],
        'notes' => RichTextFixtures::doc(RichTextFixtures::p(RichTextFixtures::text('Wichtig', 'bold'))),
    ]);

    $refused = [
        'note' => [str_repeat('x', 256), __('field.values.text', ['label' => 'Notiz', 'max' => 255])],
        'hours' => ['viel', __('field.values.number', ['label' => 'Stunden'])],
        'size' => [(string) Str::ulid(), __('field.values.option', ['label' => 'Größe'])],
        'tags' => [[$a, 'Z'], __('field.values.option', ['label' => 'Tags'])],
        'paid' => ['ja', __('field.values.boolean', ['label' => 'Bezahlt'])],
        'due' => ["2026-10-31\n", __('field.values.date', ['label' => 'Frist'])],
        'link' => ['ftp://example.com', __('field.values.url', ['label' => 'Link'])],
        'owner' => ['lene', __('field.values.member', ['label' => 'Owner'])],
        'notes' => [42, __('field.values.rich_text', ['label' => 'Notizen'])],
    ];
    foreach ($refused as $key => [$value, $message]) {
        expect(invalidOf(fn () => $check([$key => $value])))->toBe(["values.{$key}" => [$message]], $key);
    }

    expect(invalidOf(fn () => $check(['size' => [$s]])))->toBe(['values.size' => [__('field.values.single', ['label' => 'Größe'])]])
        ->and(invalidOf(fn () => $check(['link' => 'https://exa mple.com'])))->toBe(['values.link' => [__('field.values.url_invalid', ['label' => 'Link'])]])
        ->and(invalidOf(fn () => $check(['unknown' => 'x', 'note' => 'ok'])))->toBe(['values.unknown' => [__('field.values.unknown', ['key' => 'unknown', 'type' => 'Anfrage'])]]);
});

it('keeps the case of a text that looks like a ULID, and lowers only option and people ids', function () use ($world, $options) {
    [$project, $type, $properties, $lene] = $world();
    $ulid = strtoupper((string) Str::ulid());
    [, $m] = $options($properties['size']);

    expect(ItemValues::check($project, $type, ['note' => $ulid, 'link' => "https://example.com/{$ulid}", 'size' => strtoupper($m), 'owner' => strtoupper($lene->id)], [], 'create'))
        ->toBe(['note' => $ulid, 'link' => "https://example.com/{$ulid}", 'size' => $m, 'owner' => $lene->id]);
});

it('lets members and org admins be picked, but no bot outside the project and nobody unknown', function () use ($world) {
    [$project, $type, , $lene] = $world();
    $admin = User::factory()->admin()->create();
    $bot = User::factory()->bot()->create();
    $memberBot = User::factory()->bot()->create();
    app(RoleAssignments::class)->setProjectRole($memberBot, $project, ProjectRole::Member);
    $check = fn (mixed $team) => ItemValues::check($project, $type, ['team' => $team], [], 'create');

    expect($check([$lene->id, $admin->id, $memberBot->id]))->toBe(['team' => [$lene->id, $admin->id, $memberBot->id]]);

    foreach ([[$lene->id, $bot->id], [(string) Str::ulid()], [User::defaultBot()->id]] as $team) {
        expect(invalidOf(fn () => $check($team)))->toBe(['values.team' => [__('field.values.member', ['label' => 'Team'])]]);
    }
});

it('keeps people the item has while they exist, and a new pick must be able to take work', function () use ($world) {
    [$project, $type, , $lene] = $world();
    $lene->forceFill(['disabled_at' => now()])->save();
    $kira = memberOf($project, ProjectRole::Member);
    $gone = (string) Str::ulid();

    expect(ItemValues::check($project, $type, ['team' => [$lene->id, $kira->id]], ['team' => [$lene->id], 'owner' => $lene->id], 'update'))
        ->toBe(['team' => [$lene->id, $kira->id], 'owner' => $lene->id])
        ->and(invalidOf(fn () => ItemValues::check($project, $type, ['owner' => $lene->id], [], 'update')))
        ->toBe(['values.owner' => [__('field.values.member', ['label' => 'Owner'])]])
        ->and(invalidOf(fn () => ItemValues::check($project, $type, ['owner' => $gone], ['owner' => $gone], 'update')))
        ->toBe(['values.owner' => [__('field.values.member', ['label' => 'Owner'])]]);
});

it('removes an emptied value, and refuses to empty a required one only when it had a value', function () use ($world) {
    [$project, $type, $properties] = $world();
    $type->typeProperties()->where('property_id', $properties['note']->id)->update(['required' => true]);

    expect(ItemValues::check($project, $type, ['hours' => null, 'tags' => [], 'notes' => RichTextFixtures::doc(RichTextFixtures::p())], ['hours' => 2, 'tags' => ['x'], 'notes' => ['type' => 'doc']], 'update'))
        ->toBe([])
        // the property became required after the item was created: it stays empty until somebody fills it
        ->and(ItemValues::check($project, $type, ['note' => '  '], [], 'update'))->toBe([])
        ->and(ItemValues::check($project, $type, ['hours' => 2], ['count' => 1], 'update'))->toBe(['count' => 1, 'hours' => 2])
        ->and(invalidOf(fn () => ItemValues::check($project, $type, ['note' => ''], ['note' => 'Rückruf'], 'update')))
        ->toBe(['values.note' => [__('field.values.required', ['label' => 'Notiz'])]]);
});

it('reads rich text as Markdown or JSON, and refuses what is no document or too long', function () use ($world) {
    [$project, $type] = $world();
    $check = fn (mixed $notes) => ItemValues::check($project, $type, ['notes' => $notes], [], 'create');

    expect($check(RichTextFixtures::web47Steps()))->toBe(['notes' => RichTextFixtures::web47Steps()])
        ->and($check(Document::fromMarkdown('Text', new MarkdownContext)))->toBe(['notes' => RichTextFixtures::doc(RichTextFixtures::p(RichTextFixtures::text('Text')))])
        ->and($check(''))->toBe([])
        ->and(invalidOf(fn () => $check(['type' => 'doc', 'content' => [['type' => 'iframe']]])))->toBe(['values.notes' => [__('field.values.rich_text', ['label' => 'Notizen'])]])
        ->and(invalidOf(fn () => $check(str_repeat('a', Schema::MAX_BYTES + 1))))->toBe(['values.notes' => [__('field.rich_text.too_long')]]);
});

it('reads the rich text values into documents before any lock, and only those', function () use ($world) {
    [$project] = $world();
    $ctx = new MarkdownContext($project);

    [$values, $errors] = ItemValues::documents(['notes' => '**Wichtig**', 'note' => '**bleibt**', 'unknown' => 'x', 0 => 'y'], $ctx);

    expect($values['notes'])->toBeInstanceOf(Document::class)
        ->and($values['notes']->toMarkdown())->toBe('**Wichtig**')
        ->and(array_diff_key($values, ['notes' => true]))->toBe(['note' => '**bleibt**', 'unknown' => 'x', 0 => 'y'])
        ->and($errors)->toBe([])
        ->and(ItemValues::documents(['notes' => ['type' => 'paragraph']], $ctx))->toBe([['notes' => null], ['values.notes' => [__('field.values.rich_text', ['label' => 'Notizen'])]]])
        ->and(ItemValues::documents(['notes' => '  '], $ctx)[0])->toBe(['notes' => null]);
});

it('stores a multiple choice as rows in position order and reads them back in it', function () use ($world, $options) {
    [$project, $type, $properties] = $world();
    [$a, $b, $c] = $options($properties['tags']);
    $item = WorkItem::factory()->for($project)->create(['type_id' => $type->id]);

    ItemValues::store($item, ['tags' => [$c, $a, $b]], []);
    $rows = WorkItemValue::query()->where('work_item_id', $item->id)->orderBy('position')->get();

    expect($rows->map(fn (WorkItemValue $row) => [$row->position, $row->value_option_id])->all())->toBe([[0, $c], [1, $a], [2, $b]])
        ->and(ItemValues::of($item->load('values.property')))->toBe(['tags' => [$c, $a, $b]]);
});

it('reads every field type back as it was stored', function () use ($world, $options) {
    [$project, $type, $properties, $lene] = $world();
    $item = WorkItem::factory()->for($project)->create(['type_id' => $type->id]);
    $values = ItemValues::check($project, $type, [
        'note' => 'Rückruf', 'hours' => 2, 'count' => '7', 'size' => $options($properties['size'])[1], 'paid' => true,
        'due' => '2026-10-31', 'link' => 'https://example.com', 'owner' => $lene->id, 'team' => [$lene->id], 'notes' => "# Plan\n\nText",
    ], [], 'create');

    ItemValues::store($item, $values, []);
    $item->load('values.property');

    expect(ItemValues::of($item))->toEqual($values)
        ->and(ItemValues::of($item)['count'])->toBe(7)
        ->and(ItemValues::of($item)['hours'])->toBe(2)
        ->and(ItemValues::markdown($item))->toBe(['notes' => "# Plan\n\nText"]);
});

it('replaces only the rows of the values that changed', function () use ($world, $options) {
    [$project, $type, $properties] = $world();
    [$a, $b] = $options($properties['tags']);
    $item = WorkItem::factory()->for($project)->create(['type_id' => $type->id]);
    ItemValues::store($item, ['note' => 'Alt', 'tags' => [$a, $b], 'hours' => 1.5], []);
    $before = WorkItemValue::query()->where('work_item_id', $item->id)->pluck('id', 'value_option_id')->all();
    $note = WorkItemValue::query()->where('work_item_id', $item->id)->whereNotNull('value_string')->value('id');

    ItemValues::store($item, ['note' => 'Neu', 'tags' => [$a, $b]], ['note' => 'Alt', 'tags' => [$a, $b], 'hours' => 1.5]);
    $after = WorkItemValue::query()->where('work_item_id', $item->id)->get();

    expect($after->whereNotNull('value_option_id')->pluck('id', 'value_option_id')->all())->toBe(array_filter($before, fn ($key) => $key !== '', ARRAY_FILTER_USE_KEY))
        ->and($after->whereNotNull('value_string')->sole()->id)->not->toBe($note)
        ->and($after->whereNotNull('value_string')->sole()->value_string)->toBe('Neu')
        ->and($after->whereNotNull('value_number'))->toBeEmpty();
});
