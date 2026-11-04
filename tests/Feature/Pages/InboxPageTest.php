<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the inbox page for people and redirects guests', function () {
    $user = User::factory()->create();

    // the filters stay in the address: the page reads them itself, the server renders the same page
    $this->actingAs($user)->get('/inbox')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Inbox/Index'));
    $this->actingAs($user)->get('/inbox?unread=1&mentions=1')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Inbox/Index'));
    expect(route('inbox'))->toBe(url('/inbox'));
    // a guest signs in first
    auth()->logout();
    $this->get('/inbox')->assertRedirect('/login');
});
