<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the page of an item by key', function () {
    $web = Project::factory()->identifier('WEB')->private()->create();
    $mara = memberOf($web, ProjectRole::Viewer);
    $item = WorkItem::factory()->for($web)->create();

    $this->actingAs($mara)->get('/items/WEB-1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/Show')->where('itemKey', 'WEB-1'));
    // another spelling and the id: the page gets the key the item has
    $this->actingAs($mara)->get('/items/web-1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/Show')->where('itemKey', 'WEB-1'));
    $this->actingAs($mara)->get('/items/'.strtoupper($item->id))->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/Show')->where('itemKey', 'WEB-1'));
});

it('redirects a former key to the current one without caching', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->public()->create();
    WorkItem::factory()->for($web)->create();
    UpdateProject::run(actor($admin), $web, ['identifier' => 'NEW']);

    $this->actingAs($admin)->get('/items/WEB-1')->assertStatus(301)->assertRedirect('/items/NEW-1')
        // no cache keeps it: a rename back to WEB must not run into a redirect stored for good
        ->assertHeader('Cache-Control', 'no-store, private');
    $this->actingAs($admin)->get('/items/web-1')->assertStatus(301)->assertRedirect('/items/NEW-1');
    $this->actingAs($admin)->get('/items/NEW-1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/Show')->where('itemKey', 'NEW-1'));
});

it('shows the 404 page for an item the person may not see, also by a former key', function () {
    $admin = User::factory()->admin()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    WorkItem::factory()->for($ops)->create();
    UpdateProject::run(actor($admin), $ops, ['identifier' => 'SEC']);
    $outsider = User::factory()->create();

    // never a 301 that would tell the current key
    foreach (['/items/SEC-1', '/items/OPS-1', '/items/SEC-2'] as $path) {
        $this->actingAs($outsider)->get($path)->assertNotFound()->assertHeaderMissing('Location')
            ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
    }
});

it('shows the 404 page for something that is no key', function () {
    $user = User::factory()->create();

    foreach (['/items/hello', '/items/WEB-0', '/items/WEB-1', '/items/01ARZ3NDEKTSV4RRFFQ69G5FAV'] as $path) {
        $this->actingAs($user)->get($path)->assertNotFound()
            ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
    }
});

it('leads guests from an item page to the sign-in', function () {
    $this->get('/items/WEB-1')->assertRedirect('/login');
});
