<?php

use App\Domain\Properties\FieldType;
use App\Domain\Properties\PropertyShape;
use App\Models\Property;
use App\Views\CatalogProperties;
use Illuminate\Support\Facades\DB;

it('knows every property with its field type, settings and active options', function () {
    $customer = Property::factory()->dropdown(['Nordlicht', 'Hafenblick', 'Kornfeld'])->create(['key' => 'customer']);
    $options = $customer->options()->get();
    $options[1]->update(['archived_at' => now()]);
    // the position orders the options, not their ULIDs
    $options[0]->update(['position' => 5]);
    Property::factory()->create(['key' => 'reviewers', 'field_type' => FieldType::Member, 'settings' => ['multiple' => true]]);
    Property::factory()->dropdown([])->create(['key' => 'empty']);

    $catalog = CatalogProperties::load();

    expect($catalog->shape('customer'))->toEqual(new PropertyShape(FieldType::Dropdown, 0, false, [$options[2]->id, $options[0]->id]))
        ->and($catalog->shape('effort'))->toEqual(new PropertyShape(FieldType::Number, 1, false, []))
        ->and($catalog->shape('reviewers'))->toEqual(new PropertyShape(FieldType::Member, 0, true, []))
        ->and($catalog->shape('empty'))->toEqual(new PropertyShape(FieldType::Dropdown, 0, false, []))
        ->and($catalog->shape('gone'))->toBeNull();
});

it('reads the catalog with one query, once per request', function () {
    Property::factory()->dropdown(['Nordlicht', 'Hafenblick'])->create(['key' => 'customer']);

    DB::enableQueryLog();
    $catalog = app(CatalogProperties::class);
    $again = app(CatalogProperties::class);
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($again)->toBe($catalog)
        ->and($queries)->toBe(1)
        ->and($catalog->shape('customer')?->activeOptionIds)->toHaveCount(2);
});
