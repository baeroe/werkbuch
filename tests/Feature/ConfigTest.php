<?php

use Illuminate\Support\Env;

/**
 * Sets an environment variable the way the host would: .env values are loaded by Laravel itself (so the immutable
 * repository would overwrite them on the next boot); clearing them first makes the new value count as external.
 */
function setEnv(string $name, ?string $value): void
{
    Env::getRepository()->clear($name);
    putenv($value === null ? $name : $name.'='.$value);

    if ($value === null) {
        unset($_ENV[$name], $_SERVER[$name]);
    } else {
        $_ENV[$name] = $_SERVER[$name] = $value;
    }
}

afterEach(function () {
    setEnv('ATTACHMENTS_MAX_MB', null);
    setEnv('WEBHOOKS_ALLOW_PRIVATE', null);
});

it('has the documented defaults', function () {
    // independent of the developer's .env
    setEnv('ATTACHMENTS_MAX_MB', null);
    setEnv('WEBHOOKS_ALLOW_PRIVATE', null);
    $this->refreshApplication();

    expect(config('werkbuch.version'))->toBe('0.1.0-dev')
        ->and(config('werkbuch.attachments_max_mb'))->toBe(25)
        ->and(config('werkbuch.notification_mail_delay'))->toBe(5)
        ->and(config('werkbuch.webhooks_allow_private'))->toBeFalse()
        ->and(config('werkbuch.event_consumers'))->toBe([])
        ->and(config('werkbuch.rate_limits.api'))->toBe(600)
        ->and(config('werkbuch.rate_limits.mcp'))->toBe(300)
        ->and(config('werkbuch.rate_limits.login_per_ip'))->toBe(20)
        ->and(config('werkbuch.rate_limits.password_reset_per_ip'))->toBe(6)
        ->and(config('werkbuch.rate_limits.password_update_per_ip'))->toBe(10);
});

it('reads the environment', function () {
    setEnv('ATTACHMENTS_MAX_MB', '50');
    setEnv('WEBHOOKS_ALLOW_PRIVATE', 'true');
    $this->refreshApplication();

    expect(config('werkbuch.attachments_max_mb'))->toBe(50)
        ->and(config('werkbuch.webhooks_allow_private'))->toBeTrue();
});
