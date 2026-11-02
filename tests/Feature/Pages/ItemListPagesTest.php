<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\User;
use App\Models\View;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the item list of a project by identifier', function () {
    $web = Project::factory()->identifier('WEB')->private()->create();
    $mara = memberOf($web, ProjectRole::Viewer);

    $this->actingAs($mara)->get('/projects/WEB')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Show')->where('identifier', 'WEB'));
    // another spelling and the id: the page gets the identifier the project has
    $this->actingAs($mara)->get('/projects/web?layout=board')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Show')->where('identifier', 'WEB'));
    $this->actingAs($mara)->get('/projects/'.$web->id)->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Show')->where('identifier', 'WEB'));
});

it('redirects a former identifier with the query and without caching', function () {
    $admin = User::factory()->admin()->create();
    $old = Project::factory()->identifier('OLD')->public()->create();
    UpdateProject::run(actor($admin), $old, ['identifier' => 'NEW']);

    $this->actingAs($admin)->get('/projects/OLD?layout=board')->assertStatus(301)->assertRedirect('/projects/NEW?layout=board')
        // no cache keeps it: a rename back to OLD must not run into a redirect stored for good
        ->assertHeader('Cache-Control', 'no-store, private');
    $this->actingAs($admin)->get('/projects/old')->assertStatus(301)->assertRedirect('/projects/NEW');
    $this->actingAs($admin)->get('/projects/NEW?layout=board')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Show')->where('identifier', 'NEW'));
});

it('shows the 404 page for a project the person may not see', function () {
    $admin = User::factory()->admin()->create();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    UpdateProject::run(actor($admin), $ops, ['identifier' => 'SEC']);
    $outsider = User::factory()->create();

    // never a 301 that would tell the current identifier
    foreach (['/projects/SEC', '/projects/OPS', '/projects/NOPE', '/projects/'.$ops->id] as $path) {
        $this->actingAs($outsider)->get($path)->assertNotFound()->assertHeaderMissing('Location')
            ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
    }
});

it('renders a view by id and the 404 page for an unknown one', function () {
    $mara = User::factory()->create();
    $view = View::factory()->create();

    $this->actingAs($mara)->get("/views/{$view->id}")->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Views/Show')->where('viewId', $view->id));
    // an id in capitals is the same view; the page gets it as stored
    $this->actingAs($mara)->get('/views/'.strtoupper($view->id).'?layout=table')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Views/Show')->where('viewId', $view->id));

    foreach (['/views/01ARZ3NDEKTSV4RRFFQ69G5FAV', '/views/kira', '/views/'.mb_chr(0xFF10 + (int) $view->id[0]).substr($view->id, 1)] as $path) {
        $this->actingAs($mara)->get($path)->assertNotFound()
            ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
    }
});

it('renders the three lists of Meine Items', function () {
    $mara = User::factory()->create();

    foreach (['/my-items' => 'Items/MyItems', '/created' => 'Items/Created', '/subscribed' => 'Items/Subscribed'] as $path => $component) {
        $this->actingAs($mara)->get($path)->assertOk()->assertInertia(fn (Assert $page) => $page->component($component));
    }
    // the state of the list stays in the query (the server orders its parameters)
    $this->actingAs($mara)->get('/created?layout=board&group=priority')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/Created')->url('/created?group=priority&layout=board'));
});
