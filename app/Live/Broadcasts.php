<?php

namespace App\Live;

use Illuminate\Broadcasting\Broadcasters\PusherBroadcaster;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * The one way to Reverb (K1, A284): a broadcast or a disconnection is a synchronous HTTP call (2 s to connect, 3 s in
 * all, `config/broadcasting.php`), and a late live update is worth nothing. So neither ever throws: a failure is reported
 * at most once in REPORT_PAUSE seconds and the caller goes on (the consumer takes the event, a request answers as
 * always); the browser loads everything again once it connects again. LiveConsumer, NotificationsChanged and Disconnect
 * go through here only.
 */
final class Broadcasts
{
    /** Seconds between two reports of a Reverb that fails (A284: once in ten minutes). */
    public const REPORT_PAUSE = 600;

    /** Sends the message now, on the default broadcaster. */
    public static function send(LiveMessage $message): void
    {
        try {
            Broadcast::queue($message);
        } catch (Throwable $e) {
            self::failed($e);
        }
    }

    /**
     * Closes the live connections of the accounts (A281): Reverb ends every connection whose presence data names the
     * account, and Echo authorizes each of its channels anew. Broadcasters other than Reverb (`log`, `null`) have no
     * connections to close. The first failure ends the round: a Reverb that is down would fail every account.
     *
     * @param  list<string>  $ids
     */
    public static function terminate(array $ids): void
    {
        try {
            $broadcaster = Broadcast::connection();
            foreach ($ids as $id) {
                match (true) {
                    $broadcaster instanceof PusherBroadcaster => $broadcaster->getPusher()->terminateUserConnections($id),
                    $broadcaster instanceof TerminatesUsers => $broadcaster->terminateUser($id),
                    default => null,
                };
            }
        } catch (Throwable $e) {
            self::failed($e);
        }
    }

    private static function failed(Throwable $e): void
    {
        if (Cache::add('live-report', true, self::REPORT_PAUSE)) {
            report($e);
        }
    }
}
