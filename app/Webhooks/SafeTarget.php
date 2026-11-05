<?php

namespace App\Webhooks;

use App\Domain\Webhooks\Addresses;
use App\Support\WebhookInput;
use GuzzleHttp\Psr7\Uri;
use InvalidArgumentException;

/**
 * The check before every attempt (spec 6.3, A368, K5): the URL read the way Guzzle sends it (`Psr7\Uri`, host in lower
 * case), `http` or `https`, no user, a host in the one form curl and Guzzle read alike (WebhookInput), then **every**
 * address of the name: one in a blocked network refuses the target while `webhooks_allow_private` is off; that switch
 * never spares the lookup. An address literal is checked as it is, without DNS.
 */
final class SafeTarget
{
    /**
     * @throws UnsafeTarget
     */
    public static function check(string $url): Target
    {
        if (str_contains($url, '\\') || preg_match('/[\s\p{Z}\p{Cc}\p{Cf}]/u', $url) !== 0) {
            throw new UnsafeTarget(UnsafeTarget::UNRESOLVABLE);
        }

        try {
            $uri = new Uri($url);
        } catch (InvalidArgumentException) {
            throw new UnsafeTarget(UnsafeTarget::UNRESOLVABLE);
        }

        $scheme = $uri->getScheme();
        $host = $uri->getHost();
        $named = $host === '' ? null : $host;
        if (! in_array($scheme, ['http', 'https'], true)) {
            throw new UnsafeTarget(UnsafeTarget::SCHEME, $named);
        }
        if ($uri->getUserInfo() !== '') {
            throw new UnsafeTarget(UnsafeTarget::CREDENTIALS, $named);
        }

        $literal = WebhookInput::literal($host);
        if ($literal === null && ! WebhookInput::isName($host)) {
            throw new UnsafeTarget(UnsafeTarget::UNRESOLVABLE, $named);
        }
        $host = $literal ?? $host;

        $addresses = self::canonical($literal === null ? app(Resolver::class)->addresses($host) : [$literal]);
        if ($addresses === []) {
            throw new UnsafeTarget(UnsafeTarget::UNRESOLVABLE, $host);
        }
        if (! config('werkbuch.webhooks_allow_private')) {
            foreach ($addresses as $address) {
                if (Addresses::isBlocked($address)) {
                    throw new UnsafeTarget(UnsafeTarget::PRIVATE_ADDRESS, $host);
                }
            }
        }

        return new Target($url, $host, $uri->getPort() ?? ($scheme === 'https' ? 443 : 80), $addresses[0], $addresses);
    }

    /**
     * The address literals among the answers in their canonical spelling (`inet_ntop`), each once, IPv4 first.
     *
     * @param  list<string>  $answers
     * @return list<string>
     */
    private static function canonical(array $answers): array
    {
        $v4 = [];
        $v6 = [];
        foreach ($answers as $answer) {
            if (! Addresses::isIp($answer)) {
                continue;
            }
            $bytes = (string) inet_pton($answer);
            $address = (string) inet_ntop($bytes);
            if (strlen($bytes) === 4) {
                $v4[$address] = $address;
            } else {
                $v6[$address] = $address;
            }
        }

        return [...array_values($v4), ...array_values($v6)];
    }
}
