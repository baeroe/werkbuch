<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the wiki of a project and of a page', function () {
    $web = Project::factory()->identifier('WEB')->private()->create();
    $mara = memberOf($web, ProjectRole::Viewer);
    $page = Page::factory()->for($web)->create();

    $this->actingAs($mara)->get('/projects/WEB/wiki')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('identifier', 'WEB')->where('pageId', null)->where('pageFound', false));
    $this->actingAs($mara)->get("/projects/WEB/wiki/{$page->id}")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('identifier', 'WEB')->where('pageId', $page->id)->where('pageFound', true));
    // another spelling of the identifier and of the page: the page gets them as they are stored
    $this->actingAs($mara)->get('/projects/web/wiki/'.strtoupper($page->id).'?versions=1')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('identifier', 'WEB')->where('pageId', $page->id)->where('pageFound', true));
    $this->actingAs($mara)->get("/projects/{$web->id}/wiki")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')->where('identifier', 'WEB'));
});

it('passes a page id that is no page on, the wiki says so without a 404', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $mara = User::factory()->create();

    // no ULID: the text stays as it came; an unknown ULID: in lower case
    $this->actingAs($mara)->get('/projects/WEB/wiki/handbook')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('identifier', 'WEB')->where('pageId', 'handbook')->where('pageFound', false));
    $this->actingAs($mara)->get('/projects/WEB/wiki/01ARZ3NDEKTSV4RRFFQ69G5FAV')->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('pageId', '01arz3ndektsv4rrffq69g5fav')->where('pageFound', false));
});

it('redirects a former identifier with the page and the query, without caching', function () {
    $admin = User::factory()->admin()->create();
    $old = Project::factory()->identifier('OLD')->public()->create();
    $page = Page::factory()->for($old)->create();
    UpdateProject::run(actor($admin), $old, ['identifier' => 'NEW']);

    $this->actingAs($admin)->get("/projects/OLD/wiki/{$page->id}?versions=1")->assertStatus(301)
        ->assertRedirect("/projects/NEW/wiki/{$page->id}?versions=1")
        // no cache keeps it: a rename back to OLD must not run into a redirect stored for good
        ->assertHeader('Cache-Control', 'no-store, private');
    $this->actingAs($admin)->get('/projects/old/wiki')->assertStatus(301)->assertRedirect('/projects/NEW/wiki');
    $this->actingAs($admin)->get("/projects/NEW/wiki/{$page->id}")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')->where('identifier', 'NEW')->where('pageFound', true));
});

it('redirects a page of another visible project to its wiki', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $ops = Project::factory()->identifier('OPS')->public()->create();
    $page = Page::factory()->for($ops)->create();
    $mara = User::factory()->create();

    $this->actingAs($mara)->get('/projects/WEB/wiki/'.strtoupper($page->id).'?versions=1')->assertStatus(301)
        ->assertRedirect("/projects/OPS/wiki/{$page->id}?versions=1")
        ->assertHeader('Cache-Control', 'no-store, private');
});

it('renders the 404 page for a project the account does not see, never a redirect', function () {
    $admin = User::factory()->admin()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $page = Page::factory()->for($ops)->create();
    UpdateProject::run(actor($admin), $ops, ['identifier' => 'SEC']);
    $outsider = User::factory()->create();

    // never a 301 that would tell the current identifier
    foreach (['/projects/SEC/wiki', "/projects/OPS/wiki/{$page->id}", '/projects/NOPE/wiki', "/projects/{$ops->id}/wiki"] as $path) {
        $this->actingAs($outsider)->get($path)->assertNotFound()->assertHeaderMissing('Location')
            ->assertInertia(fn (Assert $inertia) => $inertia->component('Errors/NotFound'));
    }

    // a project being deleted is gone for everyone
    $ops->forceFill(['deleting_at' => now()])->save();
    $this->actingAs($admin)->get('/projects/SEC/wiki')->assertNotFound()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Errors/NotFound'));
});

it('passes pageFound false for a page the account does not see', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $sec = Project::factory()->identifier('SEC')->private()->create();
    $hidden = Page::factory()->for($sec)->create();
    $mara = User::factory()->create();

    // neither the 404 page nor a redirect that would tell the project of the page
    $this->actingAs($mara)->get("/projects/WEB/wiki/{$hidden->id}")->assertOk()->assertHeaderMissing('Location')
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')
            ->where('identifier', 'WEB')->where('pageId', $hidden->id)->where('pageFound', false));

    // a page of a project being deleted is gone as well, also for the admin
    $admin = User::factory()->admin()->create();
    $other = Project::factory()->identifier('OLD')->public()->create();
    $gone = Page::factory()->for($other)->create();
    $other->forceFill(['deleting_at' => now()])->save();
    $this->actingAs($admin)->get("/projects/WEB/wiki/{$gone->id}")->assertOk()
        ->assertInertia(fn (Assert $inertia) => $inertia->component('Wiki/Show')->where('pageFound', false));
});
