<?php

return [

    'version' => '0.1.0-dev',

    // first admin, created by the install command when no user exists yet
    'admin' => [
        'email' => env('ADMIN_EMAIL'),
        'password' => env('ADMIN_PASSWORD'),
    ],

    // comma-separated reverse proxies whose X-Forwarded-* headers are believed; empty: private networks
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    'attachments_max_mb' => (int) env('ATTACHMENTS_MAX_MB', 25),

    // minutes a notification waits before its mail goes out (a read in between cancels it)
    'notification_mail_delay' => (int) env('NOTIFICATION_MAIL_DELAY', 5),

    // webhooks to private and loopback addresses are refused unless this is on
    'webhooks_allow_private' => (bool) env('WEBHOOKS_ALLOW_PRIVATE', false),

    // classes implementing App\Events\EventConsumer: each receives every domain event once, after the commit, in its own
    // queue (App\Events\Outbox); later phases add notifications, webhooks, search, live updates and automations
    'event_consumers' => [],

    // requests per minute
    'rate_limits' => [
        'api' => 600,
        'mcp' => 300,
        'login_per_ip' => 20,
        // requests for a reset link (POST /forgot-password), over all addresses
        'password_reset_per_ip' => 6,
        // new passwords from a reset link (POST /reset-password), over all addresses
        'password_update_per_ip' => 10,
    ],

];
