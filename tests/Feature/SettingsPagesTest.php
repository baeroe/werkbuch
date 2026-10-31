<?php

use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('leads from the settings to their general section, so every screen has one address', function () {
    $this->actingAs(User::factory()->create())->get('/settings')->assertRedirect('/settings/general');
});

it('renders the section of the address, also one the page does not know', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/settings/general')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'general'));
    $this->actingAs($user)->get('/settings/people')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'people'));
    $this->actingAs($user)->get('/settings/nothing')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Organization')->where('section', 'nothing'));
});

it('leads guests from the settings to the sign-in', function () {
    $this->get('/settings')->assertRedirect('/login');
    $this->get('/settings/people')->assertRedirect('/login');
    $this->get('/me')->assertRedirect('/login');
    $this->get('/me/security')->assertRedirect('/login');
});

it('renders the personal settings with the profile first and the section of the address', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/me')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Personal')->where('section', 'profile'));
    $this->actingAs($user)->get('/me/security')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Personal')->where('section', 'security'));
    $this->actingAs($user)->get('/me/nothing')->assertOk()
        ->assertInertia(fn (Assert $page) => $page->component('Settings/Personal')->where('section', 'nothing'));
});
