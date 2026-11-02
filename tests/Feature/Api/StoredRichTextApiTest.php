<?php

use App\Access\ProjectRole;
use App\Domain\Properties\FieldType;
use App\Models\Project;
use App\Models\Property;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\WorkItemType;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/*
 * An item whose description and rich text value were stored before Phase 7 checked the content expressions (Markdown
 * `- - a` over REST): Document refuses to read them, the item page and the API answered 500 until the migration
 * 2026_10_31_000930_repair_rich_text_content repaired them.
 */

it('answers an item stored in the form of Phase 4 with 200 once the migration repaired it', function () {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $task = WorkItemType::query()->where('name', 'Task')->firstOrFail();
    $notes = Property::factory()->create(['key' => 'notes', 'label' => 'Notizen', 'field_type' => FieldType::RichText]);
    $task->typeProperties()->create(['property_id' => $notes->id, 'required' => false, 'position' => 0]);
    $item = WorkItem::factory()->for($web)->create(['type_id' => $task->id]);
    $legacy = F::doc(['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]]]]]);
    DB::table('work_items')->where('id', $item->id)->update(['description' => json_encode($legacy), 'description_text' => 'a']);
    DB::table('work_item_values')->insert([
        'id' => strtolower((string) Str::ulid()), 'work_item_id' => $item->id, 'property_id' => $notes->id, 'position' => 0,
        'value_json' => json_encode($legacy), 'value_text' => 'a', 'created_at' => now(), 'updated_at' => now(),
    ]);

    $this->actingAs($mara)->getJson('/api/v1/work-items/WEB-1')->assertServerError();

    (require base_path('database/migrations/2026_10_31_000930_repair_rich_text_content.php'))->up();

    $this->getJson('/api/v1/work-items/WEB-1')->assertOk()
        ->assertJsonPath('data.description_json.content.0.content.0.content.0', ['type' => 'paragraph'])
        ->assertJsonPath('data.description', '- - a')
        ->assertJsonPath('data.values_markdown.notes', '- - a');
});
