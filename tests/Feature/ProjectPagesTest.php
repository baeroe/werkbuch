<?php

use App\Access\ProjectRole;
use App\Actions\Projects\UpdateProject;
use App\Models\Project;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the projects overview, with the dialog only when the address asks for it', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/projects')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Index')->where('create', false));
    $this->actingAs($user)->get('/projects?create=1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Index')->where('create', true));
    $this->actingAs($user)->get('/projects?create=yes')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Index')->where('create', false));
});

it('renders the settings of a project with General first and the section of the address', function () {
    $web = Project::factory()->identifier('WEB')->public()->create();
    $user = memberOf($web, ProjectRole::Member);

    $this->actingAs($user)->get('/projects/WEB/settings')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Settings')->where('identifier', 'WEB')->where('section', 'general'));
    $this->actingAs($user)->get('/projects/WEB/settings/members')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Settings')->where('identifier', 'WEB')->where('section', 'members'));
    // another spelling of the identifier: the page gets the one the project has
    $this->actingAs($user)->get('/projects/web/settings/nothing')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Projects/Settings')->where('identifier', 'WEB')->where('section', 'nothing'));
});

it('moves an old address to the new identifier for good', function () {
    $admin = User::factory()->admin()->create();
    $web = Project::factory()->identifier('WEB')->public()->create();
    UpdateProject::run(actor($admin), $web, ['identifier' => 'SITE']);

    $this->actingAs($admin)->get('/projects/WEB/settings/members')->assertStatus(301)->assertRedirect('/projects/SITE/settings/members');
    $this->actingAs($admin)->get('/projects/WEB/settings')->assertStatus(301)->assertRedirect('/projects/SITE/settings');
    $this->actingAs($admin)->get('/projects/SITE/settings')->assertOk();
});

it('shows the 404 page for a private project to somebody outside it, as for an unknown one', function () {
    Project::factory()->identifier('OPS')->private()->create();
    $outsider = User::factory()->create();

    $this->actingAs($outsider)->get('/projects/OPS/settings')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
    $this->actingAs($outsider)->get('/projects/NOPE/settings/members')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
});

it('leads guests from the project pages to the sign-in', function () {
    Project::factory()->identifier('WEB')->public()->create();

    $this->get('/projects')->assertRedirect('/login');
    $this->get('/projects/WEB/settings')->assertRedirect('/login');
});
