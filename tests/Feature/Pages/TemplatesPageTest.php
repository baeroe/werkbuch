<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\Template;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

// `/projects/{identifier}/templates/{templateId?}`: the templates of a project and one of them (also the target of the
// links in the mails of failed runs); the page loads them itself over the API.

it('renders the templates of a project and one of them', function () {
    $web = Project::factory()->identifier('WEB')->private()->create();
    $mara = memberOf($web, ProjectRole::Viewer);
    $template = Template::factory()->for($web)->create();

    $this->actingAs($mara)->get('/projects/WEB/templates')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')
            ->where('identifier', 'WEB')->where('templateId', null));
    $this->actingAs($mara)->get("/projects/WEB/templates/{$template->id}")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')
            ->where('identifier', 'WEB')->where('templateId', $template->id));
    // another spelling of the identifier and of the template: the page gets them as they are stored
    $this->actingAs($mara)->get('/projects/web/templates/'.strtoupper($template->id))->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')
            ->where('identifier', 'WEB')->where('templateId', $template->id));
    $this->actingAs($mara)->get("/projects/{$web->id}/templates")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')->where('identifier', 'WEB'));
});

it('passes „new“ and any other text on as it came', function () {
    Project::factory()->identifier('WEB')->public()->create();
    $mara = User::factory()->create();

    $this->actingAs($mara)->get('/projects/WEB/templates/new')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')->where('templateId', 'new'));
    $this->actingAs($mara)->get('/projects/WEB/templates/maintenance')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')->where('templateId', 'maintenance'));
    // a ULID nobody has: in lower case, the page says it does not exist
    $this->actingAs($mara)->get('/projects/WEB/templates/01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')->where('templateId', '01arz3ndektsv4rrffq69g5fav'));
});

it('redirects a former identifier with the template and the query, without caching', function () {
    $admin = User::factory()->admin()->create();
    $old = Project::factory()->identifier('OLD')->public()->create();
    $template = Template::factory()->for($old)->create();
    UpdateProject::run(actor($admin), $old, ['identifier' => 'NEW']);

    $this->actingAs($admin)->get("/projects/OLD/templates/{$template->id}?runs=1")->assertStatus(301)
        ->assertRedirect("/projects/NEW/templates/{$template->id}?runs=1")
        // no cache keeps it: a rename back to OLD must not run into a redirect stored for good
        ->assertHeader('Cache-Control', 'no-store, private');
    $this->actingAs($admin)->get('/projects/old/templates')->assertStatus(301)->assertRedirect('/projects/NEW/templates');
    $this->actingAs($admin)->get('/projects/NEW/templates/new')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Templates/Index')->where('identifier', 'NEW')->where('templateId', 'new'));
});

it('renders the 404 page for a project the account does not see, never a redirect', function () {
    $admin = User::factory()->admin()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $template = Template::factory()->for($ops)->create();
    UpdateProject::run(actor($admin), $ops, ['identifier' => 'SEC']);
    $outsider = User::factory()->create();

    // never a 301 that would tell the current identifier
    foreach (['/projects/SEC/templates', "/projects/OPS/templates/{$template->id}", '/projects/NOPE/templates', "/projects/{$ops->id}/templates"] as $path) {
        $this->actingAs($outsider)->get($path)->assertNotFound()->assertHeaderMissing('Location')
            ->assertInertia(fn (Assert $inertia) => $inertia->component('Errors/NotFound'));
    }

    // a project being deleted is gone for everyone
    $ops->forceFill(['deleting_at' => now()])->save();
    $this->actingAs($admin)->get('/projects/SEC/templates')->assertNotFound()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Errors/NotFound'));
});

it('sends a guest to the sign-in', function () {
    Project::factory()->identifier('WEB')->public()->create();

    $this->get('/projects/WEB/templates')->assertRedirect('/login');
});
