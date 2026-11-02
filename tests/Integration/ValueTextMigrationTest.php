<?php

use App\Domain\Properties\FieldType;
use App\Models\Property;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\Support\RichTextFixtures;

/*
 * The migration 2026_10_31_000910_add_value_text_to_work_item_values on a database with rich text values of Phase 4,
 * stored before there was `value_text`. It runs on the migrations of the test (DatabaseMigrations), rolled back to
 * just before it (K4).
 */

const VALUE_TEXT_MIGRATION = 'database/migrations/2026_10_31_000910_add_value_text_to_work_item_values.php';

it('fills the text of rich text values that exist', function () {
    // exactly this migration, also when later phases add newer ones
    $this->artisan('migrate:rollback', ['--path' => VALUE_TEXT_MIGRATION])->assertSuccessful();
    expect(Schema::hasColumn('work_item_values', 'value_text'))->toBeFalse();

    $item = WorkItem::factory()->create();
    $steps = Property::factory()->create(['key' => 'steps', 'field_type' => FieldType::RichText]);
    $browser = Property::factory()->create(['key' => 'browser']);
    $row = function (Property $property, array $value) use ($item): string {
        $id = strtolower((string) Str::ulid());
        DB::table('work_item_values')->insert([
            'id' => $id, 'work_item_id' => $item->id, 'property_id' => $property->id, 'position' => 0,
            ...$value, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    };
    $rich = $row($steps, ['value_json' => json_encode(RichTextFixtures::web47Steps())]);
    $text = $row($browser, ['value_string' => 'Safari 19']);

    $this->artisan('migrate')->assertSuccessful();

    expect(DB::table('work_item_values')->where('id', $rich)->value('value_text'))->toBe(
        "So lässt sich der Fehler nachstellen:\nDie Formularseite in Safari (iOS 18) öffnen.\nAlle Felder ausfüllen und auf „Absenden“ tippen.\nIm Postfach des Teams liegen zwei identische Mails.",
    )->and(DB::table('work_item_values')->where('id', $text)->value('value_text'))->toBeNull();

    // and back: the column goes again
    $this->artisan('migrate:rollback', ['--path' => VALUE_TEXT_MIGRATION])->assertSuccessful();
    expect(Schema::hasColumn('work_item_values', 'value_text'))->toBeFalse();
});
