<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('renders the organization settings with the general section by default', function () {
    $this->actingAs(User::factory()->create())->get('/settings')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'general'));
});

it('renders the section of the address, also one the page does not know', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/settings/people')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'people'));
    $this->actingAs($user)->get('/settings/nothing')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'nothing'));
});

it('leads guests from the settings to the sign-in', function () {
    $this->get('/settings')->assertRedirect('/login');
    $this->get('/settings/people')->assertRedirect('/login');
});
