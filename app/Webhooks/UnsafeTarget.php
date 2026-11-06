<?php

namespace App\Webhooks;

use RuntimeException;

/**
 * A webhook address that is not sent to (spec 6.3): `scheme` (no http or https), `credentials` (a user in the URL),
 * `unresolvable` (no address, or a host in no form curl and Guzzle read alike), `private_address` (one address in a
 * blocked network) or `bot_access` ("send again" of a webhook whose bot no longer sees the project, K6). The message
 * names only the host and the reason, never the URL: its path and query may carry a token of the receiver.
 */
final class UnsafeTarget extends RuntimeException
{
    public const SCHEME = 'scheme';

    public const CREDENTIALS = 'credentials';

    public const UNRESOLVABLE = 'unresolvable';

    public const PRIVATE_ADDRESS = 'private_address';

    public const BOT_ACCESS = 'bot_access';

    /**
     * @param  self::SCHEME|self::CREDENTIALS|self::UNRESOLVABLE|self::PRIVATE_ADDRESS|self::BOT_ACCESS  $reason
     * @param  string|null  $host  `null` when the URL could not be read
     */
    public function __construct(public readonly string $reason, public readonly ?string $host = null)
    {
        parent::__construct($host === null ? "Webhook target refused: {$reason}" : "Webhook target {$host} refused: {$reason}");
    }
}
