<?php

use App\Live\LiveConsumer;
use App\Models\Attachment;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Webhooks\WebhookConsumer;

return [

    'version' => '0.1.0-dev',

    // first admin, created by the install command when no user exists yet
    'admin' => [
        'email' => env('ADMIN_EMAIL'),
        'password' => env('ADMIN_PASSWORD'),
    ],

    // comma-separated reverse proxies whose X-Forwarded-* headers are believed; empty: private networks
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    // the one default lives in Attachment::DEFAULT_MAX_MB; config/media-library.php reads the same
    'attachments_max_mb' => (int) env('ATTACHMENTS_MAX_MB', Attachment::DEFAULT_MAX_MB),

    // minutes a notification waits before its mail goes out (a read in between cancels it)
    'notification_mail_delay' => (int) env('NOTIFICATION_MAIL_DELAY', 5),

    // webhooks to private and loopback addresses are refused unless this is on
    'webhooks_allow_private' => (bool) env('WEBHOOKS_ALLOW_PRIVATE', false),

    // classes implementing App\Events\EventConsumer: each receives every domain event once, after the commit, in its own
    // queue (App\Events\Outbox): the search index, the notifications, the live updates and the webhooks (rows only, the
    // HTTP in jobs of their own). Off in tests (Tests\TestCase), where consumers() switches them on.
    'event_consumers' => [SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class],

    // all queues of the app in the order the workers take them (A278): the DDEV daemons `queue`, `queue-index` and
    // `queue-webhooks` split them (search and media apart, A301; webhooks apart, T16-M5), so do the three workers of the CI
    'queues' => ['default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk'],

    // requests per minute
    'rate_limits' => [
        'api' => 600,
        'mcp' => 300,
        'login_per_ip' => 20,
        // requests for a reset link (POST /forgot-password), over all addresses
        'password_reset_per_ip' => 6,
        // new passwords from a reset link (POST /reset-password), over all addresses
        'password_update_per_ip' => 10,
        // accepting an invitation (POST /invitations/{invitation}), over all links
        'invitation_accept_per_ip' => 10,
    ],

];
