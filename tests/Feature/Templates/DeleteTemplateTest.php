<?php

use App\Access\ProjectRole;
use App\Actions\Templates\DeleteTemplate;
use App\Events\EventType;
use App\Models\Project;
use App\Models\Template;
use App\Models\TemplateRun;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Facades\DB;

// Deleting a template (spec 4.12): its runs go with it, the items it made stay and forget it.

/** WEB (public) with Mara as an admin and Lene as a viewer, and a template with a run that made an item. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $lene = memberOf($web, ProjectRole::Viewer);
    $template = Template::factory()->create(['project_id' => $web->id, 'name' => 'Wartung']);
    $item = WorkItem::factory()->for($web)->create(['template_id' => $template->id]);
    TemplateRun::factory()->create(['template_id' => $template->id, 'work_item_id' => $item->id]);

    return [$web, $mara, $lene, $template, $item];
};

it('deletes the template with its runs and keeps the items it made', function () use ($world) {
    [$web, $mara, , $template, $item] = $world();

    DeleteTemplate::run(actor($mara), $template);
    $event = eventsOf(EventType::TemplateDeleted, $template)->sole();

    expect(Template::query()->find($template->id))->toBeNull()
        ->and(TemplateRun::query()->count())->toBe(0)
        ->and($item->fresh()?->template_id)->toBeNull()
        ->and($event->changes)->toBeNull()
        ->and($event->meta)->toMatchArray(['name' => 'Wartung'])
        ->and($event->project_id)->toBe($web->id);
});

it('refuses viewers with 403 and someone without access with 404', function () use ($world) {
    [, , $lene, $template] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $hidden = Template::factory()->create(['project_id' => $ops->id]);

    $denied = problemOf(fn () => DeleteTemplate::run(actor($lene), $template));

    expect([$denied->status, $denied->detail])->toBe([403, __('problem.detail.templates_members_only')])
        ->and(problemOf(fn () => DeleteTemplate::run(actor($lene), $hidden))->status)->toBe(404)
        ->and(Template::query()->count())->toBe(2);
});

it('refuses an archived project with 409 and a template deleted meanwhile with 404', function () use ($world) {
    [$web, $mara, , $template] = $world();
    $other = Template::factory()->create(['project_id' => $web->id]);
    DB::table('templates')->where('id', $other->id)->delete();

    $gone = problemOf(fn () => DeleteTemplate::run(actor($mara), $other));
    $web->update(['archived_at' => now()]);
    $archived = problemOf(fn () => DeleteTemplate::run(actor($mara), $template));

    expect($gone->status)->toBe(404)
        ->and([$archived->status, $archived->reason])->toBe([409, 'project_archived'])
        ->and(Template::query()->count())->toBe(1)
        ->and(eventsOf(EventType::TemplateDeleted))->toHaveCount(0);
});
