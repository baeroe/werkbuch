<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Templates\GetTemplate;
use App\Actions\Templates\ListTemplates;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;
use Tests\Support\RichTextFixtures as F;

// Reading the templates (spec 4.12, K24): whoever sees a project reads its templates, never those of one being deleted.

/** WEB (public) with Mara as an admin, OPS (private) without her, APP (private) with her as a viewer. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $app = Project::factory()->identifier('APP')->private()->member($mara, ProjectRole::Viewer)->create();

    return [$mara, $web, $ops, $app];
};

$ids = fn ($result): array => array_map(fn (Template $t) => $t->name, $result->page->items());

it('lists the templates of every project the reader sees', function () use ($world, $ids) {
    [$mara, $web, $ops, $app] = $world();
    Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung']);
    Template::factory()->create(['project_id' => $app->id, 'name' => 'Bericht']);
    Template::factory()->create(['project_id' => $ops->id, 'name' => 'Geheim']);
    $gone = Project::factory()->public()->create(['deleting_at' => now()]);
    Template::factory()->create(['project_id' => $gone->id, 'name' => 'Weg']);
    $app->update(['archived_at' => now()]);

    $all = ListTemplates::run(actor($mara), null, []);

    expect($ids($all))->toBe(['Bericht', 'Wartung'])
        ->and($all->total)->toBe(2)
        ->and($ids(ListTemplates::run(actor($mara), null, ['filter' => ['project_id' => strtoupper($app->id)]])))->toBe(['Bericht'])
        ->and($ids(ListTemplates::run(actor($mara), $app, [])))->toBe(['Bericht'])
        // a project the reader does not see is an empty list (K11), not a 404
        ->and($ids(ListTemplates::run(actor($mara), null, ['filter' => ['project_id' => $ops->id]])))->toBe([])
        ->and(problemOf(fn () => ListTemplates::run(actor($mara), $gone, []))->status)->toBe(404)
        ->and($ids(ListTemplates::run(actor(User::factory()->admin()->create()), null, [])))->toBe(['Bericht', 'Geheim', 'Wartung']);
});

it('orders by name and then id, page by page', function () use ($world, $ids) {
    [$mara, $web] = $world();
    $twins = Template::factory()->count(2)->create(['project_id' => $web->id, 'name' => 'Gleich'])->sortBy('id')->values();
    Template::factory()->create(['project_id' => $web->id, 'name' => 'Anfang']);

    $first = ListTemplates::run(actor($mara), null, ['per_page' => 2]);
    $second = ListTemplates::run(actor($mara), null, ['per_page' => 2, 'cursor' => $first->page->nextCursor()?->encode()]);

    expect($ids($first))->toBe(['Anfang', 'Gleich'])
        ->and($first->page->items()[1]->id)->toBe($twins[0]->id)
        ->and(array_map(fn (Template $t) => $t->id, $second->page->items()))->toBe([$twins[1]->id])
        ->and(invalidOf(fn () => ListTemplates::run(actor($mara), null, ['lean' => 'yes'])))->toBe(['lean' => [__('field.boolean')]]);
});

it('reads the names of its texts for the reader, and none for a lean list', function () use ($world) {
    [$mara, $web, $ops] = $world();
    $hidden = WorkItem::factory()->for($ops)->create();
    $description = F::doc(F::p(F::text('Mit '), F::mention($mara->id, 'mara'), F::text(' '), F::reference($hidden->id)));
    $template = Template::factory()->create(['project_id' => $web->id]);
    $template->update(['payload' => [...$template->payload, 'description' => $description]]);

    $full = ListTemplates::run(actor($mara), null, [])->page->items()[0];
    $lean = ListTemplates::run(actor($mara), null, ['lean' => '1'])->page->items()[0];
    $one = GetTemplate::run(actor($mara), $template->fresh());

    expect($full->lean)->toBeFalse()
        ->and($full->rich_names?->handles)->toBe([$mara->id => 'mara'])
        ->and($full->rich_names?->items)->toBe([])
        ->and($lean->lean)->toBeTrue()
        ->and($lean->rich_names)->toBeNull()
        ->and($one->rich_names?->handles)->toBe([$mara->id => 'mara']);
});

it('asks the database as often for 50 templates as for 5', function () use ($world) {
    [$mara, $web] = $world();
    $count = function (int $n) use ($mara, $web): int {
        Template::query()->delete();
        $item = WorkItem::factory()->for($web)->create();
        foreach (range(1, $n) as $i) {
            $template = Template::factory()->create(['project_id' => $web->id, 'name' => "T{$i}"]);
            $template->update(['payload' => [...$template->payload, 'description' => F::doc(F::p(F::mention($mara->id, 'mara'), F::text(' '), F::reference($item->id)))]]);
        }
        Visibility::forget();
        DB::flushQueryLog();
        DB::enableQueryLog();
        ListTemplates::run(actor($mara), null, ['per_page' => 100]);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    expect($count(50))->toBe($count(5));
});

it('hides a template of a project the reader does not see', function () use ($world) {
    [$mara, , $ops] = $world();
    $template = Template::factory()->create(['project_id' => $ops->id]);

    expect(problemOf(fn () => GetTemplate::run(actor($mara), $template))->status)->toBe(404)
        ->and(GetTemplate::run(actor(User::factory()->admin()->create()), $template)->id)->toBe($template->id);
});
