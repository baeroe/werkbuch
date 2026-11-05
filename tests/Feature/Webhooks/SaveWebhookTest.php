<?php

use App\Actions\Webhooks\SaveWebhook;
use App\Events\EventType;
use App\Models\Project;
use App\Models\User;
use App\Models\Webhook;
use App\Support\WebhookInput;
use Illuminate\Support\Facades\DB;

// Creating and replacing a webhook (spec 6.3, plan "REST"): every field is required (A75), the server makes the secret
// and shows it once, the target is checked for its form only (A368, K5), and only what changes is recorded.

/** A whole webhook as the interface sends it: the organization, two events of work items, without a bot. */
$input = fn (array $overrides = []): array => [
    'name' => 'Agent',
    'url' => 'https://receiver.example.com/hook',
    'project_id' => null,
    'events' => ['work_item.created', 'work_item.state_changed'],
    'bot_id' => null,
    'active' => true,
    ...$overrides,
];

/** The field messages of saving the input as an org admin. */
$errorsOf = fn (array $input, ?Webhook $webhook = null): array => invalidOf(
    fn () => SaveWebhook::run(actor(User::factory()->admin()->create()), $input, $webhook),
);

it('creates a webhook with a fresh secret and records its name', function () use ($input) {
    $admin = User::factory()->admin()->create();

    $saved = SaveWebhook::run(actor($admin), $input());
    $webhook = $saved['webhook'];

    expect($webhook->wasRecentlyCreated)->toBeTrue()
        ->and($webhook->name)->toBe('Agent')
        ->and($webhook->url)->toBe('https://receiver.example.com/hook')
        ->and($webhook->events)->toBe(['work_item.created', 'work_item.state_changed'])
        ->and($webhook->active)->toBeTrue()
        ->and($webhook->created_by)->toBe($admin->id)
        ->and($saved['secret'])->toMatch('/^whsec_[A-Za-z0-9_-]{43}\z/')
        ->and($webhook->fresh()?->secret)->toBe($saved['secret']);

    $event = eventsOf(EventType::WebhookCreated, $webhook)->sole();
    expect($event->actor_id)->toBe($admin->id)
        ->and($event->project_id)->toBeNull()
        ->and($event->changes)->toBe(['name' => ['old' => null, 'new' => 'Agent']]);
});

it('creates a webhook of a project and only for a bot', function () use ($input) {
    $project = Project::factory()->create(['identifier' => 'WEB']);
    $bot = User::factory()->bot()->create();

    $webhook = SaveWebhook::run(actor(User::factory()->admin()->create()), $input([
        'project_id' => strtoupper($project->id), 'bot_id' => strtoupper($bot->id),
    ]))['webhook'];

    expect($webhook->project_id)->toBe($project->id)
        ->and($webhook->bot_id)->toBe($bot->id)
        ->and(eventsOf(EventType::WebhookCreated, $webhook)->sole()->project_id)->toBe($project->id);
});

it('lets only accounts with org.manage save webhooks', function () use ($input) {
    $member = User::factory()->create();

    expect(problemOf(fn () => SaveWebhook::run(actor($member), $input())))
        ->status->toBe(403)
        ->detail->toBe(__('problem.detail.webhooks_admins_only'));

    $webhook = Webhook::factory()->create();
    expect(problemOf(fn () => SaveWebhook::run(actor($member), $input(), $webhook))->status)->toBe(403)
        ->and(Webhook::query()->count())->toBe(1);
});

it('names every missing field', function () use ($errorsOf) {
    expect($errorsOf([]))->toBe([
        'name' => [__('field.required')],
        'url' => [__('field.required')],
        'project_id' => [__('field.required')],
        'events' => [__('field.required')],
        'bot_id' => [__('field.required')],
        'active' => [__('field.required')],
    ]);
});

it('names every wrong field in one answer', function () use ($input, $errorsOf) {
    expect($errorsOf($input([
        'name' => str_repeat('a', WebhookInput::NAME_MAX + 1),
        'url' => 'ftp://receiver.example.com/hook',
        'project_id' => 'WEB',
        'events' => [],
        'bot_id' => User::factory()->create()->id,
        'active' => 'yes',
    ])))->toBe([
        'name' => [__('field.name.max', ['max' => WebhookInput::NAME_MAX])],
        'url' => [__('field.url.scheme')],
        'project_id' => [__('field.project_id.unknown')],
        'events' => [__('field.events.required')],
        'bot_id' => [__('field.bot_id.invalid')],
        'active' => [__('field.boolean')],
    ]);
});

it('trims the name and the address', function () use ($input) {
    $webhook = SaveWebhook::run(actor(User::factory()->admin()->create()), $input([
        'name' => "\u{00A0} Agent ", 'url' => " https://receiver.example.com/hook\u{3000}",
    ]))['webhook'];

    expect($webhook->name)->toBe('Agent')
        ->and($webhook->url)->toBe('https://receiver.example.com/hook');
});

it('refuses an empty name or one that is no text', function (mixed $name, string $key) use ($input, $errorsOf) {
    expect($errorsOf($input(['name' => $name])))->toBe(['name' => [__($key)]]);
})->with([
    'empty' => ['', 'field.name.required'],
    'blank' => ['   ', 'field.name.required'],
    'null' => [null, 'field.name.required'],
    'a number' => [12, 'field.name.invalid'],
]);

it('takes a name of 120 characters', function () use ($input) {
    $name = str_repeat('ä', WebhookInput::NAME_MAX);

    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['name' => $name]))['webhook']->name)->toBe($name);
});

it('refuses an empty address', function (mixed $url) use ($input, $errorsOf) {
    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.required')]]);
})->with(['empty' => [''], 'blank' => ['  '], 'null' => [null]]);

it('refuses an address that is not http or https', function (string $url) use ($input, $errorsOf) {
    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.scheme')]]);
})->with([
    'ftp' => ['ftp://receiver.example.com/hook'],
    'file' => ['file:///etc/passwd'],
    'gopher' => ['gopher://receiver.example.com:70/_'],
    'no scheme' => ['receiver.example.com/hook'],
    'javascript' => ['javascript:alert(1)'],
]);

it('refuses an address of the wrong form', function (mixed $url) use ($input, $errorsOf) {
    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.invalid')]]);
})->with([
    'no text' => [42],
    'no host' => ['https:///hook'],
    'only the scheme' => ['https://'],
    'a blank inside' => ['https://receiver.example .com/hook'],
    'a zero width space' => ["https://receiver.example.com/\u{200B}hook"],
    'a control character' => ["https://receiver.example.com/\u{0007}"],
    'too long' => ['https://receiver.example.com/'.str_repeat('a', 2048)],
    'no utf-8' => ["https://receiver.example.com/\xFF"],
    'a port out of range' => ['https://receiver.example.com:99999/hook'],
]);

it('refuses numeric, dotted and backslash hosts', function (string $url) use ($input, $errorsOf) {
    config(['werkbuch.webhooks_allow_private' => true]);

    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.invalid')]]);
})->with([
    'a decimal number' => ['http://2130706433/hook'],
    'a short dotted quad' => ['http://127.1/hook'],
    'hex' => ['http://0x7f.1/hook'],
    'hex alone' => ['http://0x7f000001/hook'],
    'octal' => ['http://0177.0.0.1/hook'],
    'five parts' => ['http://1.2.3.4.5/hook'],
    'a numeric last label' => ['http://receiver.example.123/hook'],
    'a trailing dot' => ['https://receiver.example.com./hook'],
    'an empty label' => ['https://receiver..example.com/hook'],
    'a backslash before the at' => ['http://127.0.0.1\@receiver.example.com/hook'],
    'a backslash in the path' => ['https://receiver.example.com\hook'],
    'a non-ascii host' => ['https://bücher.example.com/hook'],
    'punctuation in the host' => ['https://receiver!.example.com/hook'],
    'an IPv4 address in brackets' => ['http://[127.0.0.1]/hook'],
    'an IPv6 zone' => ['http://[fe80::1%25eth0]/hook'],
    'no brackets around IPv6' => ['http://::1/hook'],
]);

it('refuses a URL with user and password', function (string $url) use ($input, $errorsOf) {
    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.credentials')]]);
})->with([
    'user and password' => ['https://agent:geheim@receiver.example.com/hook'],
    'only a user' => ['https://agent@receiver.example.com/hook'],
    'an empty user with a password' => ['https://:geheim@receiver.example.com/hook'],
]);

it('refuses http://127.0.0.1, http://[::1], http://localhost, http://169.254.169.254 while private targets are off', function (string $url) use ($input, $errorsOf) {
    expect($errorsOf($input(['url' => $url])))->toBe(['url' => [__('field.url.private')]]);
})->with([
    'loopback' => ['http://127.0.0.1/hook'],
    'IPv6 loopback' => ['http://[::1]/hook'],
    'localhost' => ['http://localhost:8080/hook'],
    'localhost in capitals' => ['http://LocalHost/hook'],
    'a name below localhost' => ['http://receiver.localhost/hook'],
    'metadata' => ['http://169.254.169.254/latest/meta-data'],
    'a private network' => ['https://10.0.0.5/hook'],
    'v4-mapped loopback' => ['http://[::ffff:127.0.0.1]/hook'],
    'unique local' => ['http://[fd00::1]/hook'],
]);

it('takes them with webhooks_allow_private', function (string $url) use ($input) {
    config(['werkbuch.webhooks_allow_private' => true]);

    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['url' => $url]))['webhook']->url)->toBe($url);
})->with([
    'loopback' => ['http://127.0.0.1/hook'],
    'IPv6 loopback' => ['http://[::1]/hook'],
    'localhost' => ['http://localhost:8080/hook'],
    'metadata' => ['http://169.254.169.254/latest/meta-data'],
]);

it('takes public addresses, names in capitals and a port', function (string $url) use ($input) {
    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['url' => $url]))['webhook']->url)->toBe($url);
})->with([
    'an IPv4 address' => ['https://93.184.216.34/hook'],
    'an IPv6 address' => ['https://[2606:4700::1111]/hook'],
    'capitals' => ['HTTPS://Receiver.Example.COM/Hook?Token=abc'],
    'a port' => ['http://receiver.example.com:8080/hook'],
    'a dash and an underscore' => ['https://my-receiver.ex_ample.com/hook'],
    'a query and a fragment' => ['https://receiver.example.com/hook?token=abc#part'],
]);

it('takes a host name without asking DNS', function (string $url) use ($input) {
    // `localtest.me` resolves to 127.0.0.1 and `.invalid` never resolves (RFC 6761): saving checks only the form (A368),
    // the addresses are checked before every attempt
    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['url' => $url]))['webhook']->url)->toBe($url);
})->with([
    'a name of 127.0.0.1' => ['http://localtest.me/hook'],
    'a name without entry' => ['https://receiver.invalid/hook'],
]);

it('normalizes the events', function () use ($input) {
    $nine = array_values(array_filter(Webhook::catalog(), fn (string $event) => str_starts_with($event, 'work_item.')));
    expect($nine)->toHaveCount(9);

    $webhook = SaveWebhook::run(actor(User::factory()->admin()->create()), $input([
        'events' => ['comment.created', ...array_reverse($nine), 'comment.created'],
    ]))['webhook'];

    expect($webhook->events)->toBe(['work_item.*', 'comment.created']);
});

it('refuses no events, unknown events and events that are no list of names', function (mixed $events, string $message) use ($input, $errorsOf) {
    expect($errorsOf($input(['events' => $events])))->toBe(['events' => [$message]]);
})->with([
    'none' => [[], fn () => __('field.events.required')],
    'null' => [null, fn () => __('field.events.required')],
    'an unknown name' => [['work_item.created', 'work_item.nope'], fn () => __('field.events.unknown', ['name' => 'work_item.nope'])],
    'an event without webhook' => [['comment.reaction_added'], fn () => __('field.events.unknown', ['name' => 'comment.reaction_added'])],
    'an unknown group' => [['nope.*'], fn () => __('field.events.unknown', ['name' => 'nope.*'])],
    'a text' => ['work_item.*', fn () => __('field.events.invalid')],
    'a number in the list' => [['work_item.created', 7], fn () => __('field.events.invalid')],
    'a list in the list' => [[['work_item.created']], fn () => __('field.events.invalid')],
    'keys' => [['a' => 'work_item.created'], fn () => __('field.events.invalid')],
]);

it('refuses a project that does not exist or is no ULID', function (mixed $project) use ($input, $errorsOf) {
    expect($errorsOf($input(['project_id' => $project])))->toBe(['project_id' => [__('field.project_id.unknown')]]);
})->with([
    'unknown' => ['01jbz7m0000000000000000000'],
    'an identifier' => ['WEB'],
    'a number' => [7],
    'a lookalike with full-width digits' => [fn () => '０'.substr(Project::factory()->create()->id, 1)],
]);

it('refuses a project being deleted', function () use ($input, $errorsOf) {
    $project = Project::factory()->create(['deleting_at' => now()]);

    expect($errorsOf($input(['project_id' => $project->id])))->toBe(['project_id' => [__('field.project_id.unknown')]]);
});

it('takes an archived project', function () use ($input) {
    $project = Project::factory()->create(['archived_at' => now()]);

    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['project_id' => $project->id]))['webhook']->project_id)
        ->toBe($project->id);
});

it('refuses a person or a deactivated bot as bot', function (Closure $account) use ($input, $errorsOf) {
    expect($errorsOf($input(['bot_id' => $account()])))->toBe(['bot_id' => [__('field.bot_id.invalid')]]);
})->with([
    'a person' => [fn () => User::factory()->create()->id],
    'an org admin' => [fn () => User::factory()->admin()->create()->id],
    'a deactivated bot' => [fn () => User::factory()->bot()->disabled()->create()->id],
    'unknown' => [fn () => '01jbz7m0000000000000000000'],
    'no ULID' => [fn () => 'kira'],
    'a number' => [fn () => 7],
]);

it('takes the default bot as bot', function () use ($input) {
    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['bot_id' => User::defaultBot()->id]))['webhook']->bot_id)
        ->toBe(User::defaultBot()->id);
});

it('keeps a bot the webhook has, though it was deactivated', function () use ($input, $errorsOf) {
    $bot = User::factory()->bot()->create();
    $webhook = Webhook::factory()->forBot($bot)->create();
    $bot->update(['disabled_at' => now()]);

    $saved = SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['bot_id' => $bot->id, 'name' => 'Umbenannt']), $webhook);

    expect($saved['webhook']->bot_id)->toBe($bot->id)
        ->and($saved['webhook']->name)->toBe('Umbenannt')
        ->and($errorsOf($input(['bot_id' => $bot->id])))->toBe(['bot_id' => [__('field.bot_id.invalid')]])
        ->and($errorsOf($input(['bot_id' => User::factory()->create()->id]), $webhook))->toBe(['bot_id' => [__('field.bot_id.invalid')]]);
});

it('takes the values of the boolean rule for active', function (mixed $value, bool $active) use ($input) {
    expect(SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['active' => $value]))['webhook']->active)->toBe($active);
})->with([
    'true' => [true, true], 'false' => [false, false], '1' => [1, true], '0' => [0, false], "'1'" => ['1', true], "'0'" => ['0', false],
]);

it('refuses null or a word for active', function (mixed $value) use ($input, $errorsOf) {
    expect($errorsOf($input(['active' => $value])))->toBe(['active' => [__('field.boolean')]]);
})->with(['null' => [null], 'a word' => ['yes'], 'a list' => [[true]]]);

it('answers the secret only on create', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $webhook = Webhook::factory()->create();
    $before = $webhook->secret;

    $saved = SaveWebhook::run(actor($admin), $input(['name' => 'Neu']), $webhook);

    expect($saved['secret'])->toBeNull()
        ->and($saved['webhook']->fresh()?->secret)->toBe($before);
});

it('never takes a secret from the input', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $created = SaveWebhook::run(actor($admin), $input(['secret' => 'whsec_mine']));

    expect($created['secret'])->not->toBe('whsec_mine')
        ->and($created['webhook']->fresh()?->secret)->toBe($created['secret']);

    $saved = SaveWebhook::run(actor($admin), $input(['secret' => 'whsec_mine', 'name' => 'Neu']), $created['webhook']);

    expect($saved['webhook']->fresh()?->secret)->toBe($created['secret'])
        ->and(eventsOf(EventType::WebhookUpdated, $created['webhook'])->sole()->changes)->toBe(['name' => ['old' => 'Agent', 'new' => 'Neu']]);
});

it('replaces the whole webhook and records only what changed', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $project = Project::factory()->create();
    $bot = User::factory()->bot()->create();
    $webhook = SaveWebhook::run(actor($admin), $input())['webhook'];

    $saved = SaveWebhook::run(actor($admin), $input([
        'name' => 'Agent 2', 'url' => 'https://receiver.example.com/v2', 'project_id' => $project->id,
        'events' => ['comment.*'], 'bot_id' => $bot->id, 'active' => false,
    ]), $webhook)['webhook'];

    expect($saved->only(['name', 'url', 'project_id', 'events', 'bot_id', 'active']))->toBe([
        'name' => 'Agent 2', 'url' => 'https://receiver.example.com/v2', 'project_id' => $project->id,
        'events' => ['comment.*'], 'bot_id' => $bot->id, 'active' => false,
    ]);

    $event = eventsOf(EventType::WebhookUpdated, $webhook)->sole();
    expect($event->actor_id)->toBe($admin->id)
        ->and($event->project_id)->toBe($project->id)
        ->and($event->changes)->toBe([
            'name' => ['old' => 'Agent', 'new' => 'Agent 2'],
            'url' => ['old' => 'https://receiver.example.com/hook', 'new' => 'https://receiver.example.com/v2'],
            'project_id' => ['old' => null, 'new' => $project->id],
            'events' => ['old' => ['work_item.created', 'work_item.state_changed'], 'new' => ['comment.*']],
            'bot_id' => ['old' => null, 'new' => $bot->id],
            'active' => ['old' => true, 'new' => false],
        ]);
});

it('writes no event for the same state', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $webhook = SaveWebhook::run(actor($admin), $input())['webhook'];
    $this->travel(5)->minutes();

    // the events in another order and doubled are the same normal form; the answer's other keys are passed over
    $saved = SaveWebhook::run(actor($admin), $input([
        'events' => ['work_item.state_changed', 'work_item.created', 'work_item.created'],
        'id' => 'ignored', 'created_by' => 'ignored', 'disabled_at' => null,
    ]), $webhook)['webhook'];

    expect(eventsOf(EventType::WebhookUpdated, $webhook))->toHaveCount(0)
        ->and($saved->updated_at?->equalTo($webhook->updated_at))->toBeTrue();
});

it('switches a disabled webhook on again and clears its failing', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $disabledAt = now()->subHour()->startOfSecond();
    $webhook = Webhook::factory()->disabled($disabledAt)->failingSince(now()->subDay()->subHour())->create(['name' => 'Agent', 'events' => ['work_item.*']]);

    $saved = SaveWebhook::run(actor($admin), $input(['events' => ['work_item.*']]), $webhook)['webhook']->fresh();

    expect($saved?->active)->toBeTrue()
        ->and($saved?->disabled_at)->toBeNull()
        ->and($saved?->failing_since)->toBeNull()
        ->and(eventsOf(EventType::WebhookUpdated, $webhook)->sole()->changes)->toBe([
            'active' => ['old' => false, 'new' => true],
            'disabled_at' => ['old' => $disabledAt->toJSON(), 'new' => null],
        ]);
});

it('clears the failing of a webhook an admin switched off when it goes on again', function () use ($input) {
    $webhook = Webhook::factory()->failingSince(now()->subHour())->create(['name' => 'Agent', 'events' => ['work_item.*'], 'active' => false]);

    $saved = SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['events' => ['work_item.*']]), $webhook)['webhook']->fresh();

    expect($saved?->failing_since)->toBeNull()
        ->and(eventsOf(EventType::WebhookUpdated, $webhook)->sole()->changes)->toBe(['active' => ['old' => false, 'new' => true]]);
});

it('keeps the failing of a webhook that stays on', function () use ($input) {
    $since = now()->subHour();
    $webhook = Webhook::factory()->failingSince($since)->create(['name' => 'Agent', 'events' => ['work_item.*']]);

    SaveWebhook::run(actor(User::factory()->admin()->create()), $input(['events' => ['work_item.*'], 'name' => 'Neu']), $webhook);

    expect($webhook->fresh()?->failing_since?->toJSON())->toBe($since->toImmutable()->toJSON());
});

it('answers 404 for a webhook deleted meanwhile', function () use ($input) {
    $webhook = Webhook::factory()->create();
    Webhook::query()->whereKey($webhook->id)->delete();

    expect(problemOf(fn () => SaveWebhook::run(actor(User::factory()->admin()->create()), $input(), $webhook))->status)->toBe(404);
});

it('never puts the secret into an event', function () use ($input) {
    $admin = User::factory()->admin()->create();
    $created = SaveWebhook::run(actor($admin), $input());
    SaveWebhook::run(actor($admin), $input(['name' => 'Neu', 'active' => false]), $created['webhook']);

    expect(DB::table('events')->where('changes', 'like', '%whsec_%')->orWhere('meta', 'like', '%whsec_%')->count())->toBe(0)
        ->and(DB::table('events')->where('changes', 'like', '%'.substr($created['secret'], 6).'%')->count())->toBe(0)
        ->and(eventsOf(EventType::WebhookUpdated, $created['webhook'])->sole()->changes)->not->toHaveKey('secret');
});
