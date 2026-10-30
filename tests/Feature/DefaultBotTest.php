<?php

use App\Access\OrgRole;
use App\Access\Visibility;
use App\Actions\Accounts\NextHandle;
use App\Actions\Auth\Authenticate;
use App\Actions\Setup\EnsureDefaultBot;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Events\EventType;
use App\Models\Event;
use App\Models\Organization;
use App\Models\User;

it('has exactly one default bot after the migrations, an org admin without email and password', function () {
    $bot = User::query()->where('is_default_bot', true)->sole();

    expect([$bot->type, $bot->name, $bot->handle, $bot->email, $bot->password])
        ->toBe([AccountType::Bot, 'Automation', 'automation', null, null])
        ->and($bot->description)->toBe(__('bots.default.description', [], Organization::current()->locale->value))
        ->and(Visibility::orgRole($bot))->toBe(OrgRole::Admin)
        ->and(User::defaultBot()->is($bot))->toBeTrue();
});

it('notes the default bot in the history, as the system', function () {
    $event = Event::query()->where('type', EventType::BotCreated)->sole();

    expect($event->subject_id)->toBe(User::defaultBot()->id)
        ->and($event->actor_id)->toBe(User::defaultBot()->id)
        ->and($event->meta)->toBe(['via' => 'system', 'reason' => 'default_bot']);
});

it('creates no second default bot', function () {
    $bot = User::defaultBot();

    expect(EnsureDefaultBot::run()->is($bot))->toBeTrue()
        ->and(User::query()->where('is_default_bot', true)->count())->toBe(1)
        ->and(Event::query()->where('type', EventType::BotCreated)->count())->toBe(1);
});

it('takes the next free handle when a person holds automation, in the language of the organization', function () {
    Event::query()->delete(); // accounts with history stay (they are disabled, never deleted)
    User::defaultBot()->delete();
    User::factory()->create(['handle' => 'automation']);
    Organization::current()->update(['locale' => Locale::De]);

    $bot = EnsureDefaultBot::run();

    expect($bot->handle)->toBe('automation-2')
        ->and($bot->description)->toBe('Der Standard-Bot: Automatisierungen und Zeitpläne von Vorlagen handeln in seinem Namen.')
        ->and(Visibility::orgRole($bot))->toBe(OrgRole::Admin)
        ->and(User::defaultBot()->is($bot))->toBeTrue();
});

it('cannot sign in: it has neither email nor password', function () {
    expect(Authenticate::run('', ''))->toBeNull()
        ->and(Authenticate::run('automation', ''))->toBeNull()
        ->and(Authenticate::run('automation', 'automation'))->toBeNull();
});

it('suggests the next free handle for a name', function () {
    expect(NextHandle::run('Mara Lindqvist'))->toBe('mara-lindqvist');

    User::factory()->create(['handle' => 'mara-lindqvist']);

    expect(NextHandle::run('Mara Lindqvist'))->toBe('mara-lindqvist-2');
});
