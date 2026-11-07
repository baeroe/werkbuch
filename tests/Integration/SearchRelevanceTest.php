<?php

use App\Actions\Search\QuerySearch;
use App\Models\Comment;
use App\Models\Label;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Search\SearchIndexer;
use App\Search\SearchResults;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use Tests\Support\Meili;

/*
 * The settings of the table „Index“ (config/scout.php) and `matchingStrategy: all` (QuerySearch) against real
 * Meilisearch (P13): every case fails without the setting it pins, or pins what Meilisearch does by itself.
 */

beforeEach(function () {
    Meili::use();
    Artisan::call('app:search-sync');
    Meili::settle();
});

$item = fn (Project $project, string $title, array $attributes = []): WorkItem => WorkItem::factory()->for($project)->create(['title' => $title, ...$attributes]);
/** Builds every index from the database and waits until Meilisearch is done. */
$index = function (): void {
    app(SearchIndexer::class)->rebuild();
    Meili::settle();
};
$search = fn (string $q, array $query = []): SearchResults => QuerySearch::run(actor(User::factory()->admin()->create()), ['q' => $q, ...$query]);
/** The keys of the models in their order. */
$ids = fn (Collection $models): array => array_values($models->map(fn (Model $model) => $model->getKey())->all());

it('finds Kontaktformular by kontakt', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $form = $item($web, 'Kontaktformular Pflichtfelder');
    $item($web, 'Newsletter versenden');
    $index();

    expect($ids($search('kontakt', ['types' => 'items'])->items))->toBe([$form->id]);
});

it('ranks a hit in the title before a hit in the description', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $inTitle = $item($web, 'Pflichtfelder im Kontaktformular prüfen', ['updated_at' => now()->subDays(2)]);
    // the title does not begin with the word (exactness would rank it first by itself); the other hit is newer and
    // indexed later: only the weight of the attribute (searchableAttributes, rule attribute) puts it behind
    $inDescription = $item($web, 'Pflichtfelder der Website', [
        'description_text' => 'Das Kontaktformular verliert die Eingaben.',
        'updated_at' => now(),
    ]);
    $index();

    expect($ids($search('kontaktformular', ['types' => 'items'])->items))->toBe([$inTitle->id, $inDescription->id]);
});

it('finds an item by a word of a comment, after title and description matches', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    // the newer hits are indexed later and none begins with the word: only the weight of `comments` after
    // `description` (searchableAttributes, rule attribute) puts the comment last
    $inTitle = $item($web, 'Pflichtfelder im Kontaktformular prüfen', ['updated_at' => now()->subDays(3)]);
    $inDescription = $item($web, 'Pflichtfelder der Website', [
        'description_text' => 'Das Kontaktformular verliert die Eingaben.',
        'updated_at' => now()->subDays(2),
    ]);
    $inComment = $item($web, 'Pflichtfelder im Checkout', ['updated_at' => now()]);
    Comment::factory()->for($inComment, 'workItem')->create(['body_text' => 'Das Kontaktformular sendet doppelt.']);
    $index();

    expect($ids($search('kontaktformular', ['types' => 'items'])->items))->toBe([$inTitle->id, $inDescription->id, $inComment->id])
        ->and($ids($search('doppelt', ['types' => 'items'])->items))->toBe([$inComment->id]);
});

it('puts the newer of two equal hits first', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    // the older one comes first into the index (rebuild() reads by id): only updated_at:desc puts the newer first
    $older = $item($web, 'Kontaktformular Pflichtfelder', ['updated_at' => now()->subDays(3)]);
    $newer = $item($web, 'Kontaktformular Pflichtfelder', ['updated_at' => now()->subDay()]);
    $index();

    expect($ids($search('kontaktformular pflichtfelder', ['types' => 'items'])->items))->toBe([$newer->id, $older->id]);
});

it('tolerates a typo in a title word, not in a key or an identifier', function () use ($item, $index, $search, $ids) {
    // Meilisearch allows a typo from five letters on (minWordSizeForTypos.oneTypo): the identifier has five (K13)
    $kunde = Project::factory()->identifier('KUNDE')->create(['name' => 'Agenturportal']);
    $invoice = $item($kunde, 'Rechnung prüfen');
    $form = $item($kunde, 'Kontaktformular Pflichtfelder');
    $index();

    expect($invoice->key)->toBe('KUNDE-1')
        ->and($ids($search('kontaktfromular', ['types' => 'items'])->items))->toBe([$form->id])
        ->and($ids($search('KUNDE-1', ['types' => 'items'])->items))->toBe([$invoice->id])
        ->and($ids($search('KUNDE', ['types' => 'projects'])->projects))->toBe([$kunde->id]);

    $typedKey = $search('KUNDA-1', ['types' => 'items']);
    expect($typedKey->keyMatch)->toBeNull()
        ->and($ids($typedKey->items))->toBe([])
        ->and(Meili::ids('testing_work_items', 'KUNDA-1'))->toBe([])
        ->and($ids($search('KUNDA', ['types' => 'projects'])->projects))->toBe([]);
});

it('finds Über by uber and über by UBER', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $page = $item($web, 'Über uns Seite');
    $faq = $item($web, 'Fragen über Fragen');
    $index();

    expect($ids($search('uber uns', ['types' => 'items'])->items))->toBe([$page->id])
        ->and($ids($search('UBER fragen', ['types' => 'items'])->items))->toBe([$faq->id]);
});

it('needs every word of the query', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $both = $item($web, 'Kontaktformular Pflichtfelder');
    $item($web, 'Kontaktformular Design');
    $item($web, 'Pflichtfelder im Checkout');
    $index();

    // without matchingStrategy all, Meilisearch drops words from the end and finds all three
    expect($ids($search('kontaktformular pflichtfelder', ['types' => 'items'])->items))->toBe([$both->id]);
});

it('filters by project and archive in Meilisearch, not only in the database', function () use ($item, $index) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $ops = Project::factory()->identifier('OPS')->create(['name' => 'Betrieb']);
    $open = $item($web, 'Kontaktformular prüfen');
    $archived = WorkItem::factory()->for($web)->archived()->create(['title' => 'Kontaktformular alt']);
    $other = $item($ops, 'Kontaktformular sichern');
    $index();

    expect(Meili::ids('testing_work_items', 'kontakt'))->toEqualCanonicalizing([$open->id, $archived->id, $other->id])
        ->and(Meili::ids('testing_work_items', 'kontakt', 'archived = false'))->toEqualCanonicalizing([$open->id, $other->id])
        ->and(Meili::ids('testing_work_items', 'kontakt', "project_id IN ['{$web->id}'] AND archived = false"))->toBe([$open->id])
        ->and(Meili::ids('testing_projects', 'website', "id IN ['{$ops->id}']"))->toBe([]);
});

it('filters items by label and category', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    [$ux, $seo, $design] = [Label::factory()->create(['name' => 'UX']), Label::factory()->create(['name' => 'SEO']), Label::factory()->create(['name' => 'Design'])];
    $both = $item($web, 'Kontaktformular Felder');
    $uxOnly = WorkItem::factory()->for($web)->closed()->create(['title' => 'Kontaktformular Abschluss']);
    $none = $item($web, 'Kontaktformular Texte');
    $both->labels()->attach([$ux->id, $seo->id]);
    $uxOnly->labels()->attach($ux->id);
    $none->labels()->attach($design->id);
    $index();

    // any of the labels, over the list label_ids of the document
    expect($ids($search('kontaktformular', ['types' => 'items', 'label_id' => [$seo->id, $ux->id]])->items))->toEqualCanonicalizing([$both->id, $uxOnly->id])
        ->and($ids($search('kontaktformular', ['types' => 'items', 'label_id' => $seo->id])->items))->toBe([$both->id])
        ->and($ids($search('kontaktformular', ['types' => 'items', 'state_category' => 'completed'])->items))->toBe([$uxOnly->id])
        ->and($ids($search('kontaktformular', ['types' => 'items', 'state_category' => 'backlog', 'label_id' => $ux->id, 'limit' => 1])->items))->toBe([$both->id]);
});

it('finds items without an assignee', function () use ($item, $index, $search, $ids) {
    $web = Project::factory()->identifier('WEB')->create(['name' => 'Website']);
    $mara = User::factory()->create();
    $taken = $item($web, 'Kontaktformular prüfen', ['assignee_id' => $mara->id]);
    $free = $item($web, 'Kontaktformular sichern');
    $index();

    expect($ids($search('kontaktformular', ['types' => 'items', 'assignee_id' => 'none'])->items))->toBe([$free->id])
        ->and($ids($search('kontaktformular', ['types' => 'items', 'assignee_id' => Str::upper($mara->id)])->items))->toBe([$taken->id]);
});
