<?php

use App\Models\NotificationPreference;
use App\Models\User;

/** The shape of `NotificationPreference` in prototypes/clickdummy/src/types.ts. */
const NOTIFICATION_PREFERENCE_SHAPE = ['user_id', 'event', 'channel', 'enabled'];

it('reads and changes the own notification preferences', function () {
    $mara = User::factory()->create();

    $this->actingAs($mara)->getJson('/api/v1/notification-preferences')->assertOk()
        ->assertJsonCount(18, 'data')->assertJsonStructure(['data' => [NOTIFICATION_PREFERENCE_SHAPE]])
        ->assertJsonPath('data.0', ['user_id' => $mara->id, 'event' => 'assigned', 'channel' => 'inbox', 'enabled' => true])
        ->assertJsonPath('data.5', ['user_id' => $mara->id, 'event' => 'comment', 'channel' => 'mail', 'enabled' => true]);

    $this->putJson('/api/v1/notification-preferences', ['preferences' => [['event' => 'comment', 'channel' => 'mail', 'enabled' => false]]])
        ->assertOk()->assertJsonCount(18, 'data')
        ->assertJsonPath('data.5', ['user_id' => $mara->id, 'event' => 'comment', 'channel' => 'mail', 'enabled' => false]);

    $this->getJson('/api/v1/notification-preferences')->assertJsonPath('data.5.enabled', false);
});

it('answers a refused row with 422 at its place', function () {
    $this->actingAs(User::factory()->create())
        ->putJson('/api/v1/notification-preferences', ['preferences' => [['event' => 'reaction', 'channel' => 'mail', 'enabled' => false]]])
        ->assertUnprocessable()->assertJsonPath('errors', ['preferences.0.event' => [__('field.preferences.event')]]);
});

it('lets a read token read the preferences and wants write to change them', function () {
    $mara = User::factory()->create();
    $body = ['preferences' => [['event' => 'due', 'channel' => 'mail', 'enabled' => false]]];

    $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/notification-preferences')->assertOk()->assertJsonCount(18, 'data');
    $this->putJson('/api/v1/notification-preferences', $body)->assertForbidden();
    expect(NotificationPreference::query()->count())->toBe(0);

    forgetApiAuth();
    $this->withToken(apiToken($mara, ['write']))->putJson('/api/v1/notification-preferences', $body)->assertOk();
    expect(NotificationPreference::query()->where('user_id', $mara->id)->sole()->enabled)->toBeFalse();
});

it('answers a bot an empty matrix and refuses its change with 403', function () {
    $bot = User::factory()->bot()->create();

    $this->withToken(apiToken($bot, ['read', 'write']))->getJson('/api/v1/notification-preferences')->assertOk()->assertExactJson(['data' => []]);
    $this->putJson('/api/v1/notification-preferences', ['preferences' => [['event' => 'due', 'channel' => 'mail', 'enabled' => false]]])
        ->assertForbidden()->assertJsonPath('detail', __('problem.detail.persons_only_notifications'));
});
