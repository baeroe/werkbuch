<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the views and opens the dialog for ?create=1', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/views')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Views/Index')->where('create', false));
    // the sidebar's "View anlegen" asks for the dialog once
    $this->actingAs($user)->get('/views?create=1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Views/Index')->where('create', true));
    $this->actingAs($user)->get('/views?create=yes')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Views/Index')->where('create', false));
    // a guest signs in first
    auth()->logout();
    $this->get('/views')->assertRedirect('/login');
});
