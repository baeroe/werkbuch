<?php

use App\Live\LiveConsumer;
use App\Models\Attachment;
use App\Notifications\NotificationConsumer;
use App\Search\SearchConsumer;
use App\Support\LiveAddress;
use App\Webhooks\WebhookConsumer;

return [

    'version' => '0.1.0',

    // first admin, created by the install command when no user exists yet
    'admin' => [
        'email' => env('ADMIN_EMAIL'),
        'password' => env('ADMIN_PASSWORD'),
    ],

    // comma-separated reverse proxies whose X-Forwarded-* headers are believed; empty: private networks
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    // the one default lives in Attachment::DEFAULT_MAX_MB; config/media-library.php reads the same
    'attachments_max_mb' => (int) env('ATTACHMENTS_MAX_MB', Attachment::DEFAULT_MAX_MB),

    // the docs the MCP references are read from (docs/en/…); tests point it elsewhere
    'docs_path' => base_path('docs'),

    // minutes a notification waits before its mail goes out (a read in between cancels it)
    'notification_mail_delay' => (int) env('NOTIFICATION_MAIL_DELAY', 5),

    // webhooks to private and loopback addresses are refused unless this is on
    'webhooks_allow_private' => (bool) env('WEBHOOKS_ALLOW_PRIVATE', false),

    // classes implementing App\Events\EventConsumer: each receives every domain event once, after the commit, in its own
    // queue (App\Events\Outbox): the search index, the notifications, the live updates and the webhooks (rows only, the
    // HTTP in jobs of their own). Off in tests (Tests\TestCase), where consumers() switches them on.
    'event_consumers' => [SearchConsumer::class, NotificationConsumer::class, LiveConsumer::class, WebhookConsumer::class],

    // where the browser opens the WebSocket of the live updates (in Docker APP_URL, nginx forwards /app/ to Reverb);
    // apart from broadcasting.connections.reverb.options, where the server sends to (in Docker http://reverb:6001
    // inside the stack; the system page checks that same internal address)
    'live' => LiveAddress::from(env('APP_URL'), env('REVERB_PUBLIC_HOST'), env('REVERB_PUBLIC_PORT'), env('REVERB_PUBLIC_SCHEME')),

    // all queues of the app in the order the workers take them (A278): the DDEV daemons `queue`, `queue-index` and
    // `queue-webhooks` split them (search and media apart, A301; webhooks apart, T16-M5), so do the three workers of the CI
    // and the three queue services of docker-compose.yml
    'queues' => ['mail', 'default', 'live', 'notifications', 'webhooks', 'search', 'media', 'bulk'],

    // requests per minute
    'rate_limits' => [
        // /api/v1 per valid token, else per address (A387); the session of the web app per account (K9)
        'api' => (int) env('API_RATE_LIMIT', 600),
        'api_session' => (int) env('API_SESSION_RATE_LIMIT', 3000),
        // /mcp per valid token, else per address, a quota of its own beside the API's (phase 13)
        'mcp' => (int) env('MCP_RATE_LIMIT', 300),
        'login_per_ip' => 20,
        // failed sign-ins per address over all IPs within `login_account_decay` seconds; a known device is not held (A434)
        'login_per_account' => 50,
        'login_account_decay' => 3600,
        // attempts at the second factor per account within 24 hours, codes and recovery codes together (A435)
        'two_factor_per_day' => 30,
        // requests for a reset link (POST /forgot-password), over all addresses
        'password_reset_per_ip' => 6,
        // new passwords from a reset link (POST /reset-password), over all addresses
        'password_update_per_ip' => 10,
        // accepting an invitation (POST /invitations/{invitation}), over all links
        'invitation_accept_per_ip' => 10,
    ],

];
