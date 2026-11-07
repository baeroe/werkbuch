<?php

use App\Access\ProjectRole;
use App\Access\RoleAssignments;
use App\Access\Visibility;
use App\Actions\Attachments\IssueUploadUrl;
use App\Enums\Locale;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Http\Api\RateKey;
use App\Models\Attachment;
use App\Models\PersonalAccessToken;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Support\Actor;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\Mcp\McpClient;
use Tests\TestCase;

/*
 * `get-upload-url` (phase 13, task 8a; K2, K11, A403, spec 6.2): an agent sends no file as an argument, it asks for a
 * signed address and posts the file there with curl's form, without its bearer token. The address names the token by
 * its ID (never its secret), the project, the kind and the item; it lives 15 minutes at most and never longer than its
 * token, may be used again (curl starts over after a break), and every upload through it counts in the quota
 * `attachments` of the account, together with REST.
 */

beforeEach(function () {
    Storage::fake('local');
});

/** WEB with Mara as a member and Theo as a viewer, the private OPS without both; one item in each. */
$world = function (): array {
    $mara = User::factory()->create(['name' => 'Mara']);
    $theo = User::factory()->create(['name' => 'Theo']);
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Member)->member($theo, ProjectRole::Viewer)->create(['lead_id' => $mara->id]);
    $ops = Project::factory()->identifier('OPS')->create(['visibility' => 'private']);

    return [$web, $ops, WorkItem::factory()->for($web)->create(), WorkItem::factory()->for($ops)->create(), $mara, $theo];
};

/**
 * Asks for an upload address over MCP: the result.
 *
 * @param  array<string, mixed>  $input
 * @return array<string, mixed>
 */
$issue = function (TestCase $t, string $plain, array $input): array {
    return McpClient::for($t, $plain)->call('get-upload-url', ['input' => $input]);
};

/** Posts a file to the address as curl's form does: multipart, no bearer token, no session. */
$send = function (TestCase $t, string $url, ?UploadedFile $file = null, array $fields = []): TestResponse {
    forgetApiAuth();
    // a fresh request starts with the default guard `web`; the MCP call before left `sanctum` as the default of the test app
    Auth::shouldUse('web');

    return $t->post($url, [...$fields, 'file' => $file ?? UploadedFile::fake()->image('a.png')]);
};

it('issues a url and takes a file with curl\'s form', function () use ($world, $issue, $send) {
    $this->freezeSecond();
    [$web, , , , $mara] = $world();
    $plain = apiToken($mara, ['write', 'mcp']);

    $result = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline']);
    expect($result['isError'])->toBeFalse((string) json_encode($result));
    $data = $result['structuredContent']['data'];

    expect(array_keys($data))->toBe(['url', 'method', 'field', 'expires_at', 'curl'])
        ->and($data['method'])->toBe('POST')
        ->and($data['field'])->toBe('file')
        ->and($data['expires_at'])->toBe(now()->addMinutes(IssueUploadUrl::MINUTES)->toJSON())
        ->and($data['curl'])->toBe("curl -F 'file=@<path>' '{$data['url']}'")
        ->and($data['url'])->toStartWith(url('api/mcp/uploads/'.Str::before($plain, '|')).'?')
        // the project as its ULID, whatever reference the call used
        ->and($data['url'])->toContain('project_id='.$web->id)
        // never the secret of the token, neither in the address nor anywhere in the result
        ->and((string) json_encode($result))->not->toContain(Str::after($plain, '|'));

    $response = $send($this, $data['url'])->assertCreated();
    $attachment = Attachment::query()->sole();

    expect($response->json('data.id'))->toBe($attachment->id)
        ->and($attachment->kind)->toBe('inline')
        ->and($attachment->attachable_id)->toBeNull()
        ->and($attachment->project_id)->toBe($web->id)
        ->and($attachment->uploaded_by)->toBe($mara->id)
        // an upload for a text records nothing (A238)
        ->and(eventsOf(EventType::WorkItemUpdated))->toHaveCount(0);
});

it('puts a file into the list of an item', function () use ($world, $issue, $send) {
    [, , $item, , $mara] = $world();
    $plain = apiToken($mara, ['write', 'mcp']);

    $data = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => 'web-1'])['structuredContent']['data'];
    expect($data['url'])->toContain('work_item_id='.$item->id);

    $send($this, $data['url'], UploadedFile::fake()->create('angebot.pdf', 10))->assertCreated();
    $event = eventsOf(EventType::WorkItemUpdated, $item)->sole();

    expect(Attachment::query()->sole()->attachable_id)->toBe($item->id)
        ->and($event->actor_id)->toBe($mara->id)
        ->and($event->meta['via'])->toBe(Actor::VIA_MCP)
        ->and($event->meta['token_id'])->toBe(Str::before($plain, '|'));
});

it('takes the same url twice', function () use ($world, $issue, $send) {
    [, , , , $mara] = $world();
    $url = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    $send($this, $url)->assertCreated();
    $send($this, $url)->assertCreated();

    expect(Attachment::query()->count())->toBe(2);
});

it('refuses an expired url', function () use ($world, $issue, $send) {
    $this->freezeSecond();
    [, , , , $mara] = $world();
    $url = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    // the last second of its 15 minutes still takes it
    $this->travel(IssueUploadUrl::MINUTES)->minutes();
    $send($this, $url)->assertCreated();

    $this->travel(1)->seconds();
    $send($this, $url)->assertForbidden()->assertJsonPath('reason', 'forbidden');

    expect(Attachment::query()->count())->toBe(1);
});

it('expires with its token', function () use ($world, $issue, $send) {
    $this->freezeSecond();
    [, , , , $mara] = $world();
    $plain = $mara->createToken('agent', ['write', 'mcp'], now()->addMinutes(5))->plainTextToken;

    $data = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data'];
    expect($data['expires_at'])->toBe(now()->addMinutes(5)->toJSON());

    $this->travel(5)->minutes();
    $this->travel(1)->seconds();
    $send($this, $data['url'])->assertForbidden();

    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('refuses a url whose project, kind, item or token was changed', function () use ($world, $issue, $send) {
    [$web, $ops, $item, , $mara] = $world();
    $lene = User::factory()->create();
    $plain = apiToken($mara, ['write', 'mcp']);
    $url = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];
    $other = PersonalAccessToken::findToken(apiToken($lene, ['write', 'mcp']))?->getKey();

    $send($this, str_replace('project_id='.$web->id, 'project_id='.$ops->id, $url))->assertForbidden();
    $send($this, str_replace('kind=inline', 'kind=file', $url).'&work_item_id='.$item->id)->assertForbidden();
    $send($this, str_replace('/uploads/'.Str::before($plain, '|'), '/uploads/'.$other, $url))->assertForbidden();
    // without its signature it is no address at all
    $send($this, Str::before($url, '&signature='))->assertForbidden();

    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
    // the untouched address still works
    $send($this, $url)->assertCreated();
});

it('takes the project, kind and item from the signed address, never from the form', function () use ($world, $issue, $send) {
    [$web, , , , $mara] = $world();
    // a second project Mara may upload into, with an item she may change: the form names it, the address does not
    $app = Project::factory()->identifier('APP')->member($mara, ProjectRole::Member)->create();
    $appItem = WorkItem::factory()->for($app)->create();
    $url = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    $send($this, $url, null, ['project_id' => $app->id, 'kind' => 'file', 'work_item_id' => $appItem->id])->assertCreated();
    $attachment = Attachment::query()->sole();

    expect($attachment->project_id)->toBe($web->id)
        ->and($attachment->kind)->toBe('inline')
        ->and($attachment->attachable_id)->toBeNull()
        ->and(eventsOf(EventType::WorkItemUpdated, $appItem))->toHaveCount(0);
});

it('checks the rights when the address is used, not when it was issued', function () use ($world, $issue, $send) {
    [$web, , $item, , $mara] = $world();
    $roles = app(RoleAssignments::class);
    $plain = apiToken($mara, ['write', 'mcp']);
    $file = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => $item->id])['structuredContent']['data']['url'];
    // a private project she belongs to when the address is issued
    $lab = Project::factory()->identifier('LAB')->private()->member($mara, ProjectRole::Member)->create();
    $inline = $issue($this, $plain, ['project_id' => 'LAB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    // a viewer now: the list of an item is closed to her
    $roles->setProjectRole($mara, $web, ProjectRole::Viewer);
    Visibility::forget();
    $send($this, $file)->assertForbidden()->assertJsonPath('detail', __('problem.detail.items_members_only'));

    // out of the private project: it is unknown to her
    $roles->removeFromProject($mara, $lab);
    Visibility::forget();
    $send($this, $inline)->assertNotFound()->assertJsonPath('reason', 'not_found');

    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);

    // back as a member, the same address takes the file
    $roles->setProjectRole($mara, $web, ProjectRole::Member);
    Visibility::forget();
    $send($this, $file)->assertCreated();
    expect(Attachment::query()->sole()->attachable_id)->toBe($item->id);
});

it('refuses after the token was revoked or the account deactivated', function (Closure $end) use ($world, $issue, $send) {
    [, , , , $mara] = $world();
    $plain = apiToken($mara, ['write', 'mcp']);
    $url = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    $end($mara, PersonalAccessToken::findToken($plain));

    $send($this, $url)->assertUnauthorized()
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'unauthenticated');
    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
})->with([
    'revoked' => [fn (User $user, PersonalAccessToken $token) => $token->delete()],
    'expired' => [fn (User $user, PersonalAccessToken $token) => $token->forceFill(['expires_at' => now()->subSecond()])->save()],
    'deactivated' => [fn (User $user, PersonalAccessToken $token) => $user->forceFill(['disabled_at' => now()])->save()],
]);

it('refuses a token that lost write or mcp', function (array $abilities) use ($world, $issue, $send) {
    [, , , , $mara] = $world();
    $plain = apiToken($mara, ['write', 'mcp']);
    $url = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    PersonalAccessToken::findToken($plain)?->forceFill(['abilities' => $abilities])->save();

    $send($this, $url)->assertForbidden()->assertJsonPath('reason', 'forbidden');
    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
})->with([
    'without write' => [['read', 'mcp']],
    'without mcp' => [['read', 'write']],
]);

it('gives no url to a token without write or without a personal access token', function () use ($world) {
    [$web, , , , $mara] = $world();

    // over MCP the tool is unknown to a token without write
    McpClient::for($this, apiToken($mara, ['read', 'mcp']))
        ->rpc('tools/call', ['name' => 'get-upload-url', 'arguments' => (object) ['input' => ['project_id' => 'WEB', 'kind' => 'inline']]])
        ->assertStatus(400)
        ->assertJsonPath('error.code', -32602);

    $input = ['project_id' => $web->id, 'kind' => 'inline'];
    $refusal = function (Actor $actor) use ($input): Problem {
        try {
            IssueUploadUrl::run($actor, $input);
        } catch (Problem $problem) {
            return $problem;
        }

        throw new RuntimeException('IssueUploadUrl issued a url');
    };
    $tokenWith = fn (array $abilities) => new Actor($mara, Actor::VIA_MCP, token: $mara->createToken('t', $abilities)->accessToken);

    // the session (a transient token at most) and a token without mcp or write get none
    expect([$refusal(actor($mara))->status, $refusal(actor($mara))->reason])->toBe([403, 'token_required'])
        ->and([$refusal($tokenWith(['read', 'write']))->status, $refusal($tokenWith(['read', 'write']))->reason])->toBe([403, 'token_required'])
        ->and([$refusal($tokenWith(['read', 'mcp']))->status, $refusal($tokenWith(['read', 'mcp']))->reason])->toBe([403, 'forbidden'])
        // with both it gets one
        ->and(IssueUploadUrl::run($tokenWith(['write', 'mcp']), $input)['method'])->toBe('POST');
});

it('refuses an item the token may not change, like the upload', function () use ($world, $issue) {
    [, , , , $mara, $theo] = $world();

    // a viewer of WEB may put a file into a text, not into the list of an item
    $viewer = $issue($this, apiToken($theo, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => 'WEB-1']);
    expect($viewer['isError'])->toBeTrue()
        ->and($viewer['structuredContent']['status'])->toBe(403)
        ->and($viewer['structuredContent']['detail'])->toBe(__('problem.detail.items_members_only'))
        ->and($issue($this, apiToken($theo, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['isError'])->toBeFalse();

    // a project the account does not see is unknown, its item too
    $outsider = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'OPS', 'kind' => 'inline']);
    $item = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'file', 'work_item_id' => 'OPS-1']);
    expect([$outsider['structuredContent']['status'], $outsider['structuredContent']['reason']])->toBe([404, 'not_found'])
        ->and([$item['structuredContent']['status'], $item['structuredContent']['reason']])->toBe([404, 'not_found'])
        // a field missing is the field error of the upload
        ->and($issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'file'])['structuredContent']['errors'])
        ->toBe(['work_item_id' => [__('field.required')]]);
});

it('refuses a file over the limit', function () use ($world, $issue, $send) {
    config(['werkbuch.attachments_max_mb' => 1]);
    [, , , , $mara] = $world();
    $url = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    $send($this, $url, UploadedFile::fake()->create('gross.bin', 1100))
        ->assertStatus(413)
        ->assertHeader('Content-Type', 'application/problem+json')
        ->assertJsonPath('reason', 'payload_too_large')
        ->assertJsonPath('detail', __('problem.detail.payload_too_large', ['max' => 1]));

    expect(Attachment::query()->count())->toBe(0)
        ->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('shares the 60 uploads a minute with REST', function () use ($world, $issue, $send) {
    // the limiter of the uploads, lowered to two a minute; its key is the one of the app (RateKey::account)
    RateLimiter::for('attachments', fn (Request $request) => Limit::perMinute(2)->by(RateKey::account($request)));
    [$web, , , , $mara, $theo] = $world();
    $plain = apiToken($mara, ['write', 'mcp']);
    $url = $issue($this, $plain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];
    $second = $issue($this, apiToken($mara, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];
    $theoPlain = apiToken($theo, ['write', 'mcp']);
    $theos = $issue($this, $theoPlain, ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    forgetApiAuth();
    $this->withToken($plain)->post('/api/v1/attachments', ['project_id' => $web->id, 'kind' => 'inline', 'file' => UploadedFile::fake()->image('r.png')], ['Accept' => 'application/json'])
        ->assertCreated();
    $this->flushHeaders();
    $send($this, $url)->assertCreated();

    $send($this, $url)->assertStatus(429)->assertJsonPath('reason', 'too_many_requests')->assertHeader('Retry-After');
    // a second token of the same account has no quota of its own
    $send($this, $second)->assertStatus(429);
    // the address counts for the account of its token, whatever bearer token comes along
    $this->withToken($theoPlain);
    $send($this, $url)->assertStatus(429);
    $this->flushHeaders();
    // another account has its own
    $send($this, $theos)->assertCreated();

    expect(Attachment::query()->where('uploaded_by', $mara->id)->count())->toBe(2);
});

it('answers in the language of the account', function () use ($world, $issue, $send) {
    config(['werkbuch.attachments_max_mb' => 1]);
    [$web] = $world();
    $lene = memberOf($web, ProjectRole::Member, ['locale' => Locale::De]);
    $url = $issue($this, apiToken($lene, ['write', 'mcp']), ['project_id' => 'WEB', 'kind' => 'inline'])['structuredContent']['data']['url'];

    $send($this, $url, UploadedFile::fake()->create('gross.bin', 1100))
        ->assertStatus(413)
        ->assertJsonPath('detail', 'Uploads können höchstens 1 MB groß sein.');
});
