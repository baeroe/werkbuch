<?php

use App\Domain\Properties\FieldType;
use App\Domain\Properties\Placement;
use App\Models\Property;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/*
 * The migration 2026_11_17_000100_add_placement_to_properties (WEBU-6), rolled back and run again on the migrations
 * of the test: rich text goes below the description, every other property stays in the side panel.
 */

const PLACEMENT_MIGRATION = 'database/migrations/2026_11_17_000100_add_placement_to_properties.php';

it('places the properties that were there by their field type, and takes the column away again', function () {
    $this->artisan('migrate:rollback', ['--path' => PLACEMENT_MIGRATION])->assertSuccessful();
    expect(Schema::hasColumn('properties', 'placement'))->toBeFalse();
    $now = now();
    DB::table('properties')->insert([
        ['id' => strtolower((string) Str::ulid()), 'key' => 'steps_m', 'label' => 'Steps', 'field_type' => FieldType::RichText->value, 'help' => '', 'settings' => '[]', 'created_at' => $now, 'updated_at' => $now],
        ['id' => strtolower((string) Str::ulid()), 'key' => 'note_m', 'label' => 'Note', 'field_type' => FieldType::Text->value, 'help' => '', 'settings' => '[]', 'created_at' => $now, 'updated_at' => $now],
    ]);

    $this->artisan('migrate')->assertSuccessful();

    expect(Property::query()->where('key', 'steps_m')->sole()->placement)->toBe(Placement::Body)
        ->and(Property::query()->where('key', 'note_m')->sole()->placement)->toBe(Placement::Sidebar)
        ->and(Property::query()->where('key', 'effort')->sole()->placement)->toBe(Placement::Sidebar);

    Property::query()->whereIn('key', ['steps_m', 'note_m'])->delete();
});
