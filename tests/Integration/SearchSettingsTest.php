<?php

use App\Models\Project;
use App\Models\WorkItem;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\Meili;

it('syncs the settings of the four indexes into Meilisearch', function () {
    $client = Meili::use();

    expect(Artisan::call('app:search-sync'))->toBe(0);
    Meili::settle();

    $items = $client->index('testing_work_items')->getSettings();
    $pages = $client->index('testing_pages')->getSettings();
    $projects = $client->index('testing_projects')->getSettings();
    $users = $client->index('testing_users')->getSettings();

    expect($items['searchableAttributes'])->toBe(['key', 'title', 'description', 'comments'])
        ->and($items['rankingRules'][array_key_last($items['rankingRules'])])->toBe('updated_at:desc')
        ->and($items['typoTolerance']['disableOnAttributes'])->toBe(['key'])
        ->and($items['filterableAttributes'])->toContain('project_id', 'label_ids')
        ->and($pages['searchableAttributes'])->toBe(['title', 'text'])
        ->and($pages['filterableAttributes'])->toBe(['project_id'])
        ->and($pages['rankingRules'])->toBe($items['rankingRules'])
        ->and($projects['searchableAttributes'])->toBe(['identifier', 'former_identifiers', 'name', 'description'])
        ->and($users['typoTolerance']['disableOnAttributes'])->toBe(['handle']);
});

it('rebuilds an index that holds a stale document', function () {
    $client = Meili::use();
    $web = Project::factory()->identifier('WEB')->create();
    $item = WorkItem::factory()->for($web)->create(['title' => 'Kontaktformular prüfen']);
    $client->index('testing_work_items')->addDocuments([['id' => 'stale', 'project_id' => $web->id, 'key' => 'WEB-99', 'title' => 'Kontaktformular alt']], 'id');
    Meili::settle();

    expect(Meili::ids('testing_work_items', 'kontaktformular'))->toBe(['stale']);

    expect(Artisan::call('app:search-import'))->toBe(0);
    Meili::settle();

    expect(Meili::ids('testing_work_items', 'kontaktformular'))->toBe([$item->id])
        ->and(Meili::ids('testing_projects', 'WEB'))->toBe([$web->id]);
});
