<?php

use App\Domain\Properties\FieldType;
use App\Models\Property;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures as F;

/*
 * The migration 2026_10_31_000930_repair_rich_text_content on a database with documents stored before Phase 7 checked
 * the content expressions: it runs on the migrations of the test (DatabaseMigrations), rolled back to just before it.
 */

const REPAIR_MIGRATION = 'database/migrations/2026_10_31_000930_repair_rich_text_content.php';

it('repairs the stored descriptions and rich text values, and writes their text anew', function () {
    // exactly this migration, also when later phases add newer ones; its way back changes nothing
    $this->artisan('migrate:rollback', ['--path' => REPAIR_MIGRATION])->assertSuccessful();

    // what `- - a` was stored as, with the text in two nodes and the marks in another order than the editor's
    $legacy = F::doc(
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]]]]],
        F::p(F::text('Do'), F::text('ku'), ['type' => 'text', 'marks' => [['type' => 'italic'], ['type' => 'bold']], 'text' => 'fett']),
        ['type' => 'blockquote', 'content' => []],
    );
    $repaired = F::doc(
        ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [['type' => 'paragraph'], ['type' => 'bulletList', 'content' => [['type' => 'listItem', 'content' => [F::p('a')]]]]]]]],
        F::p(F::text('Doku'), ['type' => 'text', 'marks' => [['type' => 'bold'], ['type' => 'italic']], 'text' => 'fett']),
        ['type' => 'blockquote', 'content' => [['type' => 'paragraph']]],
    );
    $broken = WorkItem::factory()->create();
    $fine = WorkItem::factory()->create();
    $empty = WorkItem::factory()->create();
    $stamp = '2026-10-20 09:12:00';
    DB::table('work_items')->where('id', $broken->id)->update(['description' => json_encode($legacy), 'description_text' => 'alt', 'description_version' => 4, 'updated_at' => $stamp]);
    DB::table('work_items')->where('id', $fine->id)->update(['description' => json_encode(F::web47Steps()), 'description_text' => 'unverändert', 'updated_at' => $stamp]);
    $steps = Property::factory()->create(['key' => 'steps', 'field_type' => FieldType::RichText]);
    $value = strtolower((string) Str::ulid());
    DB::table('work_item_values')->insert([
        'id' => $value, 'work_item_id' => $broken->id, 'property_id' => $steps->id, 'position' => 0,
        'value_json' => json_encode($legacy), 'value_text' => 'alt', 'created_at' => $stamp, 'updated_at' => $stamp,
    ]);
    $events = DB::table('events')->count();

    $this->artisan('migrate')->assertSuccessful();

    $item = DB::table('work_items')->where('id', $broken->id)->first();
    $row = DB::table('work_item_values')->where('id', $value)->first();
    expect(json_decode($item->description, true))->toBe($repaired)
        ->and($item->description_text)->toBe("a\nDokufett")
        ->and($item->description_version)->toBe(4)
        ->and((string) $item->updated_at)->toBe($stamp)
        ->and(json_decode($row->value_json, true))->toBe($repaired)
        ->and($row->value_text)->toBe("a\nDokufett")
        ->and((string) $row->updated_at)->toBe($stamp)
        // a document that fits is written only when its text was off
        ->and(json_decode(DB::table('work_items')->where('id', $fine->id)->value('description'), true))->toBe(F::web47Steps())
        ->and(DB::table('work_items')->where('id', $fine->id)->value('description_text'))->toStartWith('So lässt sich der Fehler nachstellen:')
        ->and(DB::table('work_items')->where('id', $empty->id)->value('description'))->toBeNull()
        ->and(DB::table('events')->count())->toBe($events);
});
