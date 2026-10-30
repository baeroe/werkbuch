<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('leads / to my items and guests to the sign-in', function () {
    $this->get('/')->assertRedirect('/login');
    $this->actingAs(User::factory()->create())->get('/')->assertRedirect('/my-items');
});

it('renders my items for signed-in people', function () {
    $this->actingAs(User::factory()->create())->get('/my-items')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Items/MyItems'));
});

it('leads guests from my items to the sign-in', function () {
    $this->get('/my-items')->assertRedirect('/login');
});

it('shows unknown paths as 404 in the shell, but only to signed-in people', function () {
    $this->get('/projects/WEB')->assertRedirect('/login');
    $this->actingAs(User::factory()->create())->get('/projects/WEB')->assertNotFound()
        ->assertInertia(fn (Assert $page) => $page->component('Errors/NotFound'));
});

it('keeps an unknown path below /api a plain 404 problem, also for guests', function () {
    $this->getJson('api/v1/nothing-here')->assertNotFound()->assertHeader('Content-Type', 'application/problem+json');
    $this->get('api/nothing-here')->assertNotFound();
});

it('does not remember an unknown path for after the sign-in, so background requests of the browser cannot hijack it', function () {
    User::factory()->create(['email' => 'mara@example.com', 'password' => 'secret-pass']);

    $this->get('/.well-known/appspecific/com.chrome.devtools.json')->assertRedirect('/login')->assertSessionMissing('url.intended');

    $this->post('/login', ['email' => 'mara@example.com', 'password' => 'secret-pass'])->assertRedirect('/my-items');
});

it('still remembers a protected page for after the sign-in, also across unknown background requests', function () {
    $this->get('/my-items')->assertRedirect('/login')->assertSessionHas('url.intended', url('/my-items'));

    $this->get('/apple-touch-icon.png')->assertRedirect('/login');

    $this->assertSame(url('/my-items'), session('url.intended'));
});
