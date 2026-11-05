<?php

use App\Access\ProjectRole;
use App\Access\Visibility;
use App\Actions\Templates\ListTemplateRuns;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use Illuminate\Support\Facades\DB;

// The log of a template's runs: newest first to the microsecond, for whoever sees the project.

$ids = fn ($result): array => array_map(fn (TemplateRun $run) => $run->id, $result->page->items());

it('lists the runs newest first, those of one second in their order', function () use ($ids) {
    $lene = User::factory()->create();
    $web = Project::factory()->public()->member($lene, ProjectRole::Viewer)->create();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $first = TemplateRun::factory()->create(['template_id' => $template->id, 'ran_at' => '2026-11-02 09:00:00.100000']);
    $third = TemplateRun::factory()->failed('Pflicht-Property Umgebung fehlt')->create(['template_id' => $template->id, 'ran_at' => '2026-11-02 09:00:00.300000']);
    $second = TemplateRun::factory()->create(['template_id' => $template->id, 'ran_at' => '2026-11-02 09:00:00.200000']);
    TemplateRun::factory()->create(['ran_at' => '2026-11-02 09:00:00.400000']);

    $page = ListTemplateRuns::run(actor($lene), $template, ['per_page' => 2]);
    $next = ListTemplateRuns::run(actor($lene), $template, ['per_page' => 2, 'cursor' => $page->page->nextCursor()?->encode()]);

    expect($ids($page))->toBe([$third->id, $second->id])
        ->and($page->total)->toBe(3)
        ->and($ids($next))->toBe([$first->id])
        ->and(problemOf(fn () => ListTemplateRuns::run(actor(User::factory()->create()), Template::factory()->create(['project_id' => Project::factory()->private()->create()->id]), []))->status)->toBe(404);
});

it('answers the log over REST', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Member)->create();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $run = TemplateRun::factory()->failed('Kaputt')->create(['template_id' => $template->id, 'ran_at' => '2026-11-02 09:00:00.250000', 'scheduled_for' => '2026-11-02 09:00:00', 'triggered_by' => $mara->id]);
    $this->actingAs($mara);

    $this->getJson("/api/v1/templates/{$template->id}/runs")->assertOk()
        ->assertJsonPath('meta.total', 1)
        ->assertJsonPath('data.0', [
            'id' => $run->id, 'template_id' => $template->id, 'scheduled_for' => '2026-11-02T09:00:00.000000Z', 'ran_at' => '2026-11-02T09:00:00.250000Z',
            'status' => 'failed', 'work_item_id' => null, 'error' => 'Kaputt', 'triggered_by' => $mara->id,
        ]);
});

it('asks the database as often for 50 runs as for 5', function () {
    $mara = User::factory()->create();
    $web = Project::factory()->member($mara, ProjectRole::Member)->create();
    $template = Template::factory()->create(['project_id' => $web->id]);
    $count = function (int $n) use ($mara, $template): int {
        TemplateRun::query()->delete();
        TemplateRun::factory()->count($n)->create(['template_id' => $template->id]);
        $fresh = $template->fresh();
        Visibility::forget();
        DB::flushQueryLog();
        DB::enableQueryLog();
        ListTemplateRuns::run(actor($mara), $fresh, ['per_page' => 100]);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    expect($count(50))->toBe($count(5));
});
