<?php

namespace App\Http\Middleware;

use App\Support\Actor;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * In front of `/broadcasting/auth` (T9-M1, T9-M2): only the three kinds of channel the app has (`private-project.`,
 * `private-work-item.`, `presence-user.`; Laravel strips the prefix before it asks routes/channels.php, so the same
 * channel as another kind would be signed too) and a socket id of the form Pusher signs (`Actor::SOCKET_PATTERN`; any
 * other made the broadcaster throw, a reported 500). Anything else is the 403 of a refused channel.
 */
final class GuardChannelAuthorization
{
    /** @var list<string> */
    public const PREFIXES = ['private-project.', 'private-work-item.', 'presence-user.'];

    public function handle(Request $request, Closure $next): Response
    {
        if (! self::allowsChannel($request->input('channel_name')) || ! self::allowsSocket($request->input('socket_id'))) {
            throw new AccessDeniedHttpException;
        }

        return $next($request);
    }

    /** Whether `$channel` is a channel of one of the three kinds the app has (also for `ChannelBatchController`). */
    public static function allowsChannel(mixed $channel): bool
    {
        return is_string($channel) && Str::startsWith($channel, self::PREFIXES);
    }

    /** Whether `$socket` has the form of a socket id Pusher signs. */
    public static function allowsSocket(mixed $socket): bool
    {
        return is_string($socket) && preg_match(Actor::SOCKET_PATTERN, $socket) === 1;
    }
}
