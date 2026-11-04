<?php

use App\Access\ProjectRole;
use App\Actions\Projects\DeleteProject;
use App\Actions\Projects\RemoveMember;
use App\Actions\Projects\UpdateProject;
use App\Actions\Users\DeactivateUser;
use App\Actions\Users\UpdateUserRole;
use App\Events\EventType;
use App\Events\Outbox;
use App\Live\Disconnect;
use App\Live\LiveConsumer;
use App\Models\Project;
use App\Models\User;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Exceptions;
use Pusher\Pusher;

/*
 * Who loses access is disconnected (Task 10, A281): Reverb closes every connection whose presence data names the
 * account, Echo connects again and every channel is authorized anew, a lost one answers 403 (ChannelAuthorizationTest).
 * WEB (public) with Tom as its admin and lead and Mara as a member; Erik is an org admin without membership, Ida an org
 * member outside WEB, Olga deactivated, Kira a bot.
 */

beforeEach(function () {
    $this->live = broadcasts();
    consumers(LiveConsumer::class);
});

$world = function (): array {
    $tom = User::factory()->admin()->create(['name' => 'Tom']);
    $web = Project::factory()->identifier('WEB')->public()->member($tom, ProjectRole::Admin)->create(['lead_id' => $tom->id]);
    $mara = memberOf($web, ProjectRole::Member, ['name' => 'Mara']);
    $erik = User::factory()->admin()->create(['name' => 'Erik']);
    $ida = User::factory()->create(['name' => 'Ida']);
    $olga = User::factory()->disabled()->create(['name' => 'Olga']);
    $kira = User::factory()->bot($tom)->create(['name' => 'Kira']);

    return compact('tom', 'web', 'mara', 'erik', 'ida', 'olga', 'kira');
};

/** Reverb behind a Guzzle mock: the requests the app makes, answered in turn by `$answers`. */
$reverb = function (array $answers): ArrayObject {
    liveChannels();
    $requests = new ArrayObject;
    $stack = HandlerStack::create(new MockHandler($answers));
    $stack->push(Middleware::history($requests));
    app(BroadcastManager::class)->connection('reverb')->setPusher(new Pusher('live-key', 'live-secret', 'live', ['host' => '127.0.0.1', 'port' => 6001, 'scheme' => 'http'], new Client(['handler' => $stack])));

    return $requests;
};

it('disconnects a removed member', function () use ($world) {
    $w = $world();

    RemoveMember::run(actor($w['tom']), $w['web'], $w['mara']);

    expect($this->live->terminated())->toBe([$w['mara']->id])
        ->and(array_column($this->live->sent(), 'channels'))->toBe([["private-project.{$w['web']->id}"]]);
});

it('disconnects everybody without membership when a project turns private', function () use ($world) {
    $w = $world();
    $ole = User::factory()->create(['name' => 'Ole']);

    UpdateProject::run(actor($w['tom']), $w['web'], ['visibility' => 'private']);

    // members and org admins still see it; deactivated accounts and bots have no connection
    expect($this->live->terminated())->toEqualCanonicalizing([$w['ida']->id, $ole->id])
        ->and(array_column($this->live->sent(), 'channels'))->toBe([["private-project.{$w['web']->id}"]]);
});

it('disconnects nobody when a project turns public or keeps its visibility', function () use ($world) {
    $w = $world();
    $ops = Project::factory()->identifier('OPS')->private()->member($w['tom'], ProjectRole::Admin)->create(['lead_id' => $w['tom']->id]);

    UpdateProject::run(actor($w['tom']), $ops, ['visibility' => 'public']);
    UpdateProject::run(actor($w['tom']), $w['web'], ['name' => 'Website neu', 'visibility' => 'public']);

    expect(eventsOf(EventType::ProjectUpdated))->toHaveCount(2)
        ->and($this->live->terminated())->toBe([]);
});

it('disconnects nobody for a project that is gone meanwhile', function () use ($world) {
    $w = $world();
    consumers();
    UpdateProject::run(actor($w['tom']), $w['web'], ['visibility' => 'private']);
    DeleteProject::run(actor($w['tom']), $w['web']);    // the purge runs at once on the sync queue
    consumers(LiveConsumer::class);

    app(Outbox::class)->consume(eventsOf(EventType::ProjectUpdated, $w['web'])->sole()->id, LiveConsumer::class);

    expect(Project::query()->find($w['web']->id))->toBeNull()
        ->and($this->live->terminated())->toBe([])
        ->and($this->live->sent())->toHaveCount(1);
});

it('disconnects an org admin who became a member', function () use ($world) {
    $w = $world();

    UpdateUserRole::run(actor($w['tom']), $w['erik'], 'member');

    expect($this->live->terminated())->toBe([$w['erik']->id])
        // the message to the own channel goes out before the connection closes
        ->and(array_column($this->live->sent(), 'channels'))->toBe([["presence-user.{$w['erik']->id}"]]);
});

it('disconnects a deactivated account', function () use ($world) {
    $w = $world();

    DeactivateUser::run(actor($w['tom']), $w['mara']);

    expect($this->live->terminated())->toBe([$w['mara']->id])
        ->and($this->live->sent())->toBe([]);
});

it('does nothing for the log broadcaster', function () use ($world) {
    $w = $world();
    config(['broadcasting.default' => 'log']);
    app(BroadcastManager::class)->forgetDrivers();
    Exceptions::fake();

    RemoveMember::run(actor($w['tom']), $w['web'], $w['mara']);
    Disconnect::users([$w['ida']->id]);

    expect($this->live->terminated())->toBe([]);
    Exceptions::assertNothingReported();
});

it("disconnects through Reverb's terminate connections", function () use ($world, $reverb) {
    $w = $world();
    $requests = $reverb([new Response(200, [], '{}'), new Response(200, [], '{}')]);

    RemoveMember::run(actor($w['tom']), $w['web'], $w['mara']);

    $paths = array_map(fn (array $entry) => $entry['request']->getMethod().' '.$entry['request']->getUri()->getPath(), $requests->getArrayCopy());
    expect($paths)->toBe(['POST /apps/live/events', "POST /apps/live/users/{$w['mara']->id}/terminate_connections"]);
});

it('goes on with the other accounts after a refusal for one, and sets no mark (T10-M4)', function () use ($world, $reverb) {
    $w = $world();
    $requests = $reverb([new Response(200, [], '{}'), new Response(404, [], 'Unknown user'), new Response(200, [], '{}')]);
    User::factory()->create(['name' => 'Lene']);
    Exceptions::fake();

    UpdateProject::run(actor($w['tom']), $w['web'], ['visibility' => 'private']);

    // the message and both disconnections: a 4xx is about one account, not about Reverb
    expect($requests)->toHaveCount(3)
        ->and(Cache::has('live-down'))->toBeFalse();
    Exceptions::assertReportedCount(1);
});

it('stops at the first failure when Reverb is down and reports it once', function () use ($world, $reverb) {
    $w = $world();
    $down = fn () => new ConnectException('Connection refused', new Request('POST', '/'));
    $requests = $reverb([$down(), $down(), $down(), $down()]);
    User::factory()->count(2)->create();
    Exceptions::fake();

    UpdateProject::run(actor($w['tom']), $w['web'], ['visibility' => 'private']);

    // the message and the first of three disconnections: no wait for every account against a dead Reverb
    expect($requests)->toHaveCount(2)
        ->and(Cache::has('live-down'))->toBeTrue();
    Exceptions::assertReportedCount(1);
});
