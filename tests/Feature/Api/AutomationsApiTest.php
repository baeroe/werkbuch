<?php

use App\Access\ProjectRole;
use App\Domain\Automations\AutomationKey;
use App\Models\Automation;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/*
 * The automations of a project over REST (spec 4.13, A346): `GET /api/v1/projects/{project}/automations` (always five,
 * in the order of the keys) and `PUT …/automations/{key}` (`{enabled, settings}`). WEB (public) with Mara as its admin
 * and Tom as a member.
 */

$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Admin)->create();
    $tom = memberOf($web, ProjectRole::Member, ['name' => 'Tom']);

    return [$web, $mara, $tom];
};

it('answers five automations in the order of the keys, the missing ones without an id', function () use ($world) {
    [$web, , $tom] = $world();
    $stored = Automation::factory()->for($web)->key(AutomationKey::CloseParent)->enabled()->create();

    $response = $this->actingAs($tom)->getJson('/api/v1/projects/web/automations')->assertOk();

    expect($response->json())->toBe(['data' => [
        ['id' => null, 'project_id' => $web->id, 'key' => 'auto_archive', 'enabled' => false, 'settings' => ['days' => 30]],
        ['id' => null, 'project_id' => $web->id, 'key' => 'auto_close', 'enabled' => false, 'settings' => ['days' => 90, 'state_id' => null]],
        ['id' => $stored->id, 'project_id' => $web->id, 'key' => 'close_parent', 'enabled' => true, 'settings' => []],
        ['id' => null, 'project_id' => $web->id, 'key' => 'assign_on_start', 'enabled' => false, 'settings' => []],
        ['id' => null, 'project_id' => $web->id, 'key' => 'link_references', 'enabled' => true, 'settings' => []],
    ]])
        // settings are an object, also when empty
        ->and($response->getContent())->toContain('"settings":{}');
});

it('asks the database as often for no stored automation as for four', function () use ($world) {
    [$web, , $tom] = $world();
    $count = function () use ($tom): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->actingAs($tom)->getJson('/api/v1/projects/WEB/automations')->assertOk();
        DB::disableQueryLog();

        return count(DB::getQueryLog());
    };

    // once to warm up the account and its roles, then the list alone
    $count();
    $none = $count();
    foreach (AutomationKey::cases() as $key) {
        Automation::factory()->for($web)->key($key)->create();
    }

    expect($count())->toBe($none);
});

it('switches an automation and answers it', function () use ($world) {
    [$web, $mara] = $world();
    $cancelled = (string) $web->workflow()->firstOrFail()->states()->where('name', 'Cancelled')->value('id');

    $response = $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/auto_close', ['enabled' => true, 'settings' => ['days' => 120, 'state_id' => $cancelled]])
        ->assertOk();

    expect($response->json())->toBe(['data' => [
        'id' => Automation::query()->sole()->id, 'project_id' => $web->id, 'key' => 'auto_close', 'enabled' => true,
        'settings' => ['days' => 120, 'state_id' => $cancelled],
    ]]);

    // the own answer again is no change
    $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/auto_close', $response->json('data'))->assertOk()
        ->assertJsonPath('data.settings.days', 120);
});

it('refuses invalid settings at their field and a member with the sentence of the policy', function () use ($world) {
    [, $mara, $tom] = $world();

    $days = $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/auto_archive', ['enabled' => true, 'settings' => ['days' => 0]])
        ->assertUnprocessable()->assertJsonPath('reason', 'validation_failed');
    $state = $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/auto_close', ['enabled' => true])->assertUnprocessable();

    expect($days->json('errors'))->toBe(['settings.days' => [__('field.settings.days', ['min' => 1, 'max' => 3650])]])
        ->and($state->json('errors'))->toBe(['settings.state_id' => [__('field.settings.state_id')]]);
    forgetApiAuth();
    $this->actingAs($tom)->putJson('/api/v1/projects/WEB/automations/auto_archive', ['enabled' => true])
        ->assertForbidden()
        ->assertJsonPath('detail', __('problem.detail.automations_admins_only'));
});

it('knows no other key, and hides a project the account does not see', function () use ($world) {
    [, $mara] = $world();
    Project::factory()->identifier('OPS')->private()->create();

    $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/auto_nothing', ['enabled' => true])->assertNotFound();
    $this->actingAs($mara)->putJson('/api/v1/projects/WEB/automations/Auto_Archive', ['enabled' => true])->assertNotFound();
    $this->actingAs($mara)->getJson('/api/v1/projects/OPS/automations')->assertNotFound()->assertJsonMissingPath('detail');
    $this->actingAs($mara)->putJson('/api/v1/projects/OPS/automations/auto_archive', ['enabled' => true])->assertNotFound();
});

it('lets a read token list and only a write token switch', function () use ($world) {
    [, $mara] = $world();
    $read = apiToken($mara, ['read']);
    $write = apiToken($mara, ['read', 'write']);

    $this->withToken($read)->getJson('/api/v1/projects/WEB/automations')->assertOk();
    $this->withToken($read)->putJson('/api/v1/projects/WEB/automations/assign_on_start', ['enabled' => true])->assertForbidden();
    forgetApiAuth();
    $this->withToken($write)->putJson('/api/v1/projects/WEB/automations/assign_on_start', ['enabled' => true])->assertOk()
        ->assertJsonPath('data.enabled', true);
});
