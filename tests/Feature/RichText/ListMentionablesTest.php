<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Actions\RichText\ListMentionables;
use App\Exceptions\Problem;
use App\Models\Project;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/** WEB is public, Mara is its member; Jonas is an org admin and no member; Lene reads WEB only as an outsider. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara Lindqvist', 'handle' => 'mara']);
    $web = Project::factory()->identifier('WEB')->public()->member($mara, ProjectRole::Member)->create();
    $jonas = User::factory()->admin()->create(['name' => 'Jonas Brandt', 'handle' => 'jonas']);
    $lene = User::factory()->create(['name' => 'Lene Vogt', 'handle' => 'lene']);

    return [$web, $mara, $jonas, $lene];
};

$mentionables = fn (User $reader, array $query): Collection => ListMentionables::run(actor($reader), $query);
/** The handles in their order. */
$handles = fn (Collection $users): array => array_values($users->map(fn (User $user) => $user->handle)->all());

it('lists members and org admins, bots only as members', function () use ($world, $mentionables, $handles) {
    [$web, $mara, $jonas, $lene] = $world();
    $viewer = memberOf($web, ProjectRole::Viewer, ['name' => 'Tom Viewer', 'handle' => 'tom']);
    $kira = User::factory()->bot($mara)->create(['name' => 'Kira', 'handle' => 'kira']);
    app(RoleAssignments::class)->setProjectRole($kira, $web, ProjectRole::Member);
    User::factory()->bot($mara)->admin()->create(['name' => 'Admin Bot', 'handle' => 'admin-bot']);
    $ops = Project::factory()->identifier('OPS')->private()->create();
    memberOf($ops, ProjectRole::Member, ['name' => 'Ida Ops', 'handle' => 'ida']);

    expect($handles($mentionables($lene, ['project' => 'WEB'])))->toBe(['jonas', 'mara', 'tom', 'kira'])
        ->and($handles($mentionables($viewer, ['project' => $web->id])))->toBe(['jonas', 'mara', 'tom', 'kira']);
});

it('leaves out the default bot unless it is a member', function () use ($world, $mentionables, $handles) {
    [$web, $mara] = $world();

    expect($handles($mentionables($mara, ['project' => 'WEB'])))->not->toContain('automation');

    app(RoleAssignments::class)->setProjectRole(User::defaultBot(), $web, ProjectRole::Member);

    expect($handles($mentionables($mara, ['project' => 'WEB'])))->toContain('automation');
});

it('leaves out deactivated accounts', function () use ($world, $mentionables, $handles) {
    [$web, $mara] = $world();
    memberOf($web, ProjectRole::Member, ['name' => 'Gone Member', 'handle' => 'gone', 'disabled_at' => now()]);
    User::factory()->admin()->disabled()->create(['name' => 'Gone Admin', 'handle' => 'gone-admin']);
    $bot = User::factory()->bot($mara)->disabled()->create(['name' => 'Gone Bot', 'handle' => 'gone-bot']);
    app(RoleAssignments::class)->setProjectRole($bot, $web, ProjectRole::Member);

    expect($handles($mentionables($mara, ['project' => 'WEB'])))->toBe(['jonas', 'mara']);
});

it('puts starts of words first and people before bots', function () use ($world, $mentionables, $handles) {
    [$web, $mara] = $world();
    memberOf($web, ProjectRole::Member, ['name' => 'Anna Marabu', 'handle' => 'anna']);
    memberOf($web, ProjectRole::Member, ['name' => 'Tamara Keller', 'handle' => 'tamara']);
    memberOf($web, ProjectRole::Member, ['name' => 'Erik Ende', 'handle' => 'mar-e']);
    $bot = User::factory()->bot($mara)->create(['name' => 'Marvin', 'handle' => 'marvin']);
    app(RoleAssignments::class)->setProjectRole($bot, $web, ProjectRole::Member);

    // starts of a word of the name or of the handle (people before bots, then by name), then hits inside a word
    expect($handles($mentionables($mara, ['project' => 'WEB', 'q' => '  MAR '])))->toBe(['anna', 'mar-e', 'mara', 'marvin', 'tamara'])
        ->and($handles($mentionables($mara, ['project' => 'WEB', 'q' => 'ara'])))->toBe(['anna', 'mara', 'tamara'])
        ->and($handles($mentionables($mara, ['project' => 'WEB', 'q' => 'mar', 'limit' => '2'])))->toBe(['anna', 'mar-e']);
});

it('takes % and _ in the query literally', function () use ($world, $mentionables, $handles) {
    [$web, $mara] = $world();
    memberOf($web, ProjectRole::Member, ['name' => 'Ten_Percent', 'handle' => 'ten']);

    expect($handles($mentionables($mara, ['project' => 'WEB', 'q' => '%'])))->toBe([])
        ->and($handles($mentionables($mara, ['project' => 'WEB', 'q' => '_'])))->toBe(['ten'])
        ->and($handles($mentionables($mara, ['project' => 'WEB', 'q' => '\\'])))->toBe([]);
});

it('answers 404 for an invisible project', function () use ($world, $mentionables) {
    [$web, $mara] = $world();
    $ops = Project::factory()->identifier('OPS')->private()->create();
    $deleting = Project::factory()->identifier('OLD')->public()->member($mara, ProjectRole::Member)->create(['deleting_at' => now()]);

    foreach (['OPS', $ops->id, 'NOPE', $deleting->identifier] as $reference) {
        expect(fn () => $mentionables($mara, ['project' => $reference]))->toThrow(fn (Problem $problem) => expect($problem->getStatusCode())->toBe(404));
    }
});

it('refuses a missing project, a long query and a limit out of range in one answer', function () use ($world) {
    [, $mara] = $world();

    expect(invalidOf(fn () => ListMentionables::run(actor($mara), ['q' => str_repeat('a', 65), 'limit' => '51'])))->toBe([
        'project' => [__('field.required')],
        'q' => [__('field.q.max', ['max' => 64])],
        'limit' => [__('field.limit.invalid', ['max' => 50])],
    ])->and(invalidOf(fn () => ListMentionables::run(actor($mara), ['project' => ['WEB'], 'limit' => 0])))->toBe([
        'project' => [__('field.required')],
        'limit' => [__('field.limit.invalid', ['max' => 50])],
    ])->and(ListMentionables::run(actor($mara), ['project' => 'WEB', 'q' => str_repeat('ä', 64), 'limit' => 50]))->toBeEmpty();
});

it('refuses a query that is no text instead of listing everyone (T11-M1)', function () use ($world) {
    [, $mara] = $world();

    expect(invalidOf(fn () => ListMentionables::run(actor($mara), ['project' => 'WEB', 'q' => ['ma']])))->toBe(['q' => [__('field.q.invalid')]]);
    $this->actingAs($mara)->getJson('/api/v1/mentions?project=WEB&q[]=ma')->assertUnprocessable()->assertJsonPath('errors.q', [__('field.q.invalid')]);
});

it('lists 20 accounts unless asked for more', function () use ($world, $mentionables) {
    [$web, $mara] = $world();
    foreach (range(1, 25) as $n) {
        memberOf($web, ProjectRole::Member);
    }

    expect($mentionables($mara, ['project' => 'WEB']))->toHaveCount(20)
        ->and($mentionables($mara, ['project' => 'WEB', 'limit' => 50]))->toHaveCount(27);
});

it('answers over REST with a read token, avatars included', function () use ($world) {
    Storage::fake('local');
    [, $mara, $jonas] = $world();
    $jonas->addMediaFromBase64(imageDataUrl())->usingFileName('jonas.png')->toMediaCollection('avatar');

    $response = $this->withToken(apiToken($mara, ['read']))->getJson('/api/v1/mentions?project=web&q=jo')->assertOk();

    expect($response->json('data'))->toHaveCount(1)
        ->and($response->json('data.0.handle'))->toBe('jonas')
        ->and($response->json('data.0.avatar_url'))->toStartWith('http');
});
