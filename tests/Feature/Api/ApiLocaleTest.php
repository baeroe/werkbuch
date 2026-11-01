<?php

use App\Access\ProjectRole;
use App\Enums\Locale;
use App\Models\Organization;
use App\Models\Project;

/** A project WEB with a viewer and a member, both of the given profile language (null: none of their own). */
$world = function (?Locale $locale): array {
    $project = Project::factory()->identifier('WEB')->create();
    $viewer = memberOf($project, ProjectRole::Viewer, ['locale' => $locale]);
    $member = memberOf($project, ProjectRole::Member, ['locale' => $locale]);

    return [$project, $viewer, $member];
};

it('answers a session in the language of the person, not the one of the organization', function (Locale $org, Locale $person) use ($world) {
    Organization::current()->update(['locale' => $org]);
    [$project, $viewer, $member] = $world($person);

    $this->actingAs($viewer)->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => 'Item'])
        ->assertForbidden()->assertJsonPath('detail', trans('problem.detail.items_members_only', [], $person->value));
    $response = $this->actingAs($member)->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => ' '])->assertUnprocessable();

    expect(errorsAt($response, 'title'))->toBe([trans('field.title.required', [], $person->value)])
        ->and(trans('field.title.required', [], 'de'))->not->toBe(trans('field.title.required', [], 'en'));
})->with([
    'German person in an English organization' => [Locale::En, Locale::De],
    'English person in a German organization' => [Locale::De, Locale::En],
]);

it('answers a bearer token in the language of its account', function (Locale $org, Locale $person) use ($world) {
    Organization::current()->update(['locale' => $org]);
    [$project, $viewer, $member] = $world($person);

    $this->withToken(apiToken($viewer, ['read', 'write']))->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => 'Item'])
        ->assertForbidden()->assertJsonPath('detail', trans('problem.detail.items_members_only', [], $person->value));
    forgetApiAuth();
    $response = $this->withToken(apiToken($member, ['read', 'write']))->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => ' '])
        ->assertUnprocessable();

    expect(errorsAt($response, 'title'))->toBe([trans('field.title.required', [], $person->value)]);
})->with([
    'German person in an English organization' => [Locale::En, Locale::De],
    'English person in a German organization' => [Locale::De, Locale::En],
]);

it('answers in the language of the organization for an account without its own, and ignores the cookie', function () use ($world) {
    Organization::current()->update(['locale' => Locale::De]);
    [$project, $viewer] = $world(null);

    $this->withToken(apiToken($viewer, ['read', 'write']))->withUnencryptedCookie('locale', 'en')
        ->postJson('/api/v1/work-items', ['project_id' => $project->id, 'title' => 'Item'])
        ->assertForbidden()->assertJsonPath('detail', trans('problem.detail.items_members_only', [], 'de'))
        // the cookie is the browser's, the API neither reads nor writes it
        ->assertCookieMissing('locale');
});

it('refuses a request without an account in the language of the organization', function () {
    Organization::current()->update(['locale' => Locale::De]);

    $this->getJson('/api/v1/work-items')->assertUnauthorized()->assertJsonPath('detail', trans('problem.reason.unauthenticated', [], 'de'));
});
