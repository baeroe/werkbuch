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
