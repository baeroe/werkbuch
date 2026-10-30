<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Models\Event;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;

/*
 * The last active admin among the people can neither be demoted nor deactivated (spec 4.3); the default bot does not
 * count. The race of two admins at the same time: tests/Integration/LastAdminRaceTest.php.
 */

/**
 * Takes the admin role away from the account (`demote`) or deactivates it (`deactivate`), as the given admin.
 */
function takeAdminAway(User $admin, User $target, string $call): TestResponse
{
    $test = test()->actingAs($admin);

    return $call === 'demote'
        ? $test->putJson("/api/v1/users/{$target->id}/role", ['org_role' => 'member'])
        : $test->postJson("/api/v1/users/{$target->id}/deactivate");
}

it('refuses to demote or deactivate the last active admin among the people', function (string $call) {
    $mara = User::factory()->admin()->create();                 // the default bot is an admin as well
    User::factory()->admin()->disabled()->create();             // a deactivated admin does not count
    $response = $call === 'demote'
        ? $this->actingAs($mara)->putJson("/api/v1/users/{$mara->id}/role", ['org_role' => 'member'])
        : $this->actingAs($mara)->postJson("/api/v1/users/{$mara->id}/deactivate");
    $response->assertConflict()->assertJsonPath('reason', 'last_admin');
    expect(Visibility::orgRole($mara->fresh()))->toBe(OrgRole::Admin)->and($mara->fresh()->disabled_at)->toBeNull();
})->with(['demote', 'deactivate']);

it('explains the refusal with the sentence of the clickdummy', function (string $call) {
    app()->setLocale('de');
    $mara = User::factory()->admin()->create();

    takeAdminAway($mara, $mara, $call)->assertConflict()
        ->assertJsonPath('detail', 'Das ist der letzte aktive Admin. Mache zuerst jemand anderen zum Admin.');
})->with(['demote', 'deactivate']);

it('refuses the same without the default bot', function (string $call) {
    $bot = User::defaultBot();
    Event::query()->where('actor_id', $bot->id)->delete();     // events point to their actor
    $bot->delete();
    $mara = User::factory()->admin()->create();

    takeAdminAway($mara, $mara, $call)->assertConflict()->assertJsonPath('reason', 'last_admin');
    expect(Visibility::orgRole($mara->fresh()))->toBe(OrgRole::Admin)->and($mara->fresh()->disabled_at)->toBeNull();
})->with(['demote', 'deactivate']);

it('lets an admin go once another active person is admin', function (string $call) {
    $mara = User::factory()->admin()->create();
    $erik = User::factory()->admin()->create();

    takeAdminAway($erik, $mara, $call)->assertOk();

    $call === 'demote'
        ? expect(Visibility::orgRole($mara->fresh()))->toBe(OrgRole::Member)
        : expect($mara->fresh()->disabled_at)->not->toBeNull();
})->with(['demote', 'deactivate']);

it('never counts a bot, also one with the admin role', function (string $call) {
    $mara = User::factory()->admin()->create();
    $bot = User::factory()->bot($mara)->admin()->create();

    takeAdminAway($mara, $bot, $call)->assertOk();
    takeAdminAway($mara, $mara, $call)->assertConflict()->assertJsonPath('reason', 'last_admin');
})->with(['demote', 'deactivate']);

it('lets the last admin keep the role it has', function () {
    $mara = User::factory()->admin()->create();

    $this->actingAs($mara)->putJson("/api/v1/users/{$mara->id}/role", ['org_role' => 'admin'])->assertOk()->assertJsonPath('data.org_role', 'admin');
});

it('counts the admins under a lock on their rows', function (string $call) {
    $mara = User::factory()->admin()->create();
    $erik = User::factory()->admin()->create();

    DB::enableQueryLog();
    takeAdminAway($mara, $erik, $call)->assertOk();

    $locked = collect(DB::getQueryLog())->pluck('query')
        ->filter(fn (string $query) => str_starts_with($query, 'select `users`.`id` from `users`') && str_ends_with($query, 'for update'));
    expect($locked)->toHaveCount(1);
})->with(['demote', 'deactivate']);

it('counts afresh what the request read about roles before', function () {
    $mara = User::factory()->admin()->create();
    $erik = User::factory()->admin()->create();
    expect(Visibility::orgRole($erik))->toBe(OrgRole::Admin);          // the request now keeps Erik as an admin

    // Erik loses the role behind the back of the request (another request, another process)
    DB::table('model_has_roles')->where('model_id', $erik->id)->delete();

    takeAdminAway($mara, $mara, 'demote')->assertConflict()->assertJsonPath('reason', 'last_admin');
});

it('counts an admin promoted earlier in the same request', function () {
    $mara = User::factory()->admin()->create();
    $erik = User::factory()->create();

    $this->actingAs($mara)->putJson("/api/v1/users/{$erik->id}/role", ['org_role' => 'admin'])->assertOk();
    takeAdminAway($mara, $mara, 'demote')->assertOk();

    expect(Visibility::orgRole($erik->fresh()))->toBe(OrgRole::Admin)
        ->and(Visibility::orgRole($mara->fresh()))->toBe(OrgRole::Member);
});
