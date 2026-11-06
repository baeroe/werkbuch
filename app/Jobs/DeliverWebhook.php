<?php

namespace App\Jobs;

use App\Actions\Webhooks\PrepareWebhookAttempt;
use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Domain\Webhooks\Addresses;
use App\Domain\Webhooks\Backoff;
use App\Domain\Webhooks\Signature;
use App\Models\User;
use App\Models\WebhookAttempt;
use App\Models\WebhookDelivery;
use App\Support\Actor;
use App\Support\Redact;
use App\Webhooks\PinnedAddressNotUsed;
use App\Webhooks\ResponseTooLarge;
use App\Webhooks\Target;
use App\Webhooks\UnsafeTarget;
use GuzzleHttp\TransferStats;
use Illuminate\Http\Client\PendingRequest;
use Spatie\WebhookServer\CallWebhookJob;
use Spatie\WebhookServer\WebhookCall;
use Throwable;

/**
 * One delivery of a webhook (spec 6.3) as the job of spatie/laravel-webhook-server: queue `webhooks`, the tries and
 * the pauses of Backoff (A365), the timeout and the rest from config/webhook-server.php (K1).
 *
 * The job carries only the ID of the delivery and the kind of attempt (K7, T6-M4, spec 7.5): no body, no URL, no secret.
 * Each try reads them afresh (PrepareWebhookAttempt), sends to the address checked after DNS (CURLOPT_RESOLVE), never
 * through a proxy, follows no redirect, reads at most RESPONSE_MAX bytes of the answer, signs with the timestamp of the
 * try and is then logged (RecordWebhookAttempt, outside spatie's `try`, K2). What a try learns lives in private
 * properties set in handle(): release() queues the payload of the job as it was first queued, which never had them.
 */
final class DeliverWebhook extends CallWebhookJob
{
    /** What spatie wants as the URL of the job; each try sends to the URL of the webhook as it is then (T6-M4). */
    public const PLACEHOLDER_URL = 'urn:werkbuch:webhook-delivery';

    /** The most of an answer a try reads (K4); the log keeps 2 KB of it. */
    public const RESPONSE_MAX = 65536;

    /** At most this long to connect (the whole call: `timeout_in_seconds` 10). */
    public const CONNECT_TIMEOUT = 5;

    private Target|UnsafeTarget|null $target = null;

    private ?string $secret = null;

    private ?string $url = null;

    private string $event = '';

    /**
     * What the sync tries of this process recorded, per delivery and kind: sendNow() hands out its own attempt, never one
     * a scheduled try of another process wrote meanwhile (M1).
     *
     * @var array<string, WebhookAttempt|null>
     */
    private static array $recorded = [];

    /**
     * Queues the first try of the delivery after the commit of the transaction that wrote it. Not named `queue`: the
     * bus calls a method of that name on a job to push it itself.
     */
    public static function enqueue(WebhookDelivery $delivery): void
    {
        self::call($delivery, WebhookAttempt::SCHEDULED)->dispatch()->afterCommit();
    }

    /**
     * One try now, in this process, with no further ones (a test ping or "send again", A367): the same job on the sync
     * queue with a single try. Answers the attempt it recorded, `null` when nothing was sent or the log failed. Call it outside any transaction of your own: the request waits for the receiver.
     *
     * @param  WebhookAttempt::MANUAL|WebhookAttempt::PING  $kind
     */
    public static function sendNow(WebhookDelivery $delivery, string $kind): ?WebhookAttempt
    {
        $key = $delivery->id.':'.$kind;
        unset(self::$recorded[$key]);
        self::call($delivery, $kind)->maximumTries(1)->dispatchSync();

        $attempt = self::$recorded[$key] ?? null;
        unset(self::$recorded[$key]);

        return $attempt;
    }

    /** create() reads config/webhook-server.php; a useJob() after it would throw those settings away (K1). */
    private static function call(WebhookDelivery $delivery, string $kind): WebhookCall
    {
        return WebhookCall::create()
            ->url(self::PLACEHOLDER_URL)
            ->sendRawBody('')
            ->uuid($delivery->id)
            ->meta(['delivery_id' => $delivery->id, 'kind' => $kind])
            ->doNotSign();
    }

    public function handle(): void
    {
        $deliveryId = (string) ($this->meta['delivery_id'] ?? $this->uuid);
        /** @var WebhookAttempt::SCHEDULED|WebhookAttempt::MANUAL|WebhookAttempt::PING $kind */
        $kind = $this->meta['kind'] ?? WebhookAttempt::SCHEDULED;
        $actor = Actor::system(User::defaultBot(), 'webhooks');

        $prepared = PrepareWebhookAttempt::run($actor, $deliveryId, $kind);
        if ($prepared === null) {
            return; // nothing to send: the job ends without a next try
        }
        $this->target = $prepared['target'];
        $this->secret = $prepared['secret'];
        $this->url = $prepared['url'];
        $this->event = $prepared['event'];
        $this->preparedBody = $prepared['body'];

        $started = hrtime(true);
        parent::handle();
        $seconds = $this->transferStats?->getTransferTime();
        $durationMs = (int) round($seconds !== null ? $seconds * 1000 : (hrtime(true) - $started) / 1e6);

        try {
            $attempt = RecordWebhookAttempt::run($actor, $deliveryId, $this->response?->status(), $durationMs, $this->response?->body(),
                $this->response === null ? $this->error() : null, $kind, $this->attempts() >= $this->tries);
            if ($kind !== WebhookAttempt::SCHEDULED) {
                self::$recorded[$deliveryId.':'.$kind] = $attempt;
            }
        } catch (Throwable $exception) {
            // a lost log line is better than a second request (K2): the delivery stays pending, the pruning finishes it
            report($exception);
        }
    }

    /**
     * The pauses of the worker after a try that threw before it was sent (T7-M5: the database, a secret it cannot
     * decrypt): the same as after a failed request (spatie releases those itself with WebhookBackoff), not at once.
     *
     * @return list<int>
     */
    public function backoff(): array
    {
        return array_map(fn (int $attempt): int => Backoff::delayAfter($attempt), range(1, 7));
    }

    public function getWebhookUrl(): string
    {
        return $this->url ?? parent::getWebhookUrl();
    }

    /**
     * The request of this try: the werkbuch headers, the signature over the timestamp of this try and the body (spec
     * 6.3). A refused target is thrown here, before any request, and spatie counts it as a failed try.
     */
    protected function createRequest(): PendingRequest
    {
        if ($this->target instanceof UnsafeTarget) {
            throw $this->target;
        }

        $timestamp = (int) now()->timestamp;

        return parent::createRequest()->withHeaders([
            'X-Werkbuch-Event' => $this->event,
            'X-Werkbuch-Delivery' => (string) ($this->meta['delivery_id'] ?? $this->uuid),
            'X-Werkbuch-Timestamp' => (string) $timestamp,
            'X-Werkbuch-Signature' => Signature::sign((string) $this->secret, $timestamp, $this->getBody()),
            'User-Agent' => 'werkbuch/'.config('werkbuch.version'),
        ]);
    }

    /**
     * spatie's options (`verify`, the transfer stats) and the guards of werkbuch (K4, K5): no redirect, no proxy of the
     * environment (a proxy would resolve the name itself), at most 5 s to connect, the name pinned to the checked
     * addresses (an address literal needs no pin), at most RESPONSE_MAX bytes of the answer, and an answer from an
     * address that was not checked refused.
     *
     * @return array<string, mixed>
     */
    protected function requestOptions(): array
    {
        $pin = $this->target instanceof Target ? $this->target->curlResolve() : null;

        return [
            ...parent::requestOptions(),
            'allow_redirects' => false,
            // Guzzle would unpack gzip/br: the progress callback counts the bytes of the wire, and 50 KB can be 50 MB (T7-I1)
            'decode_content' => false,
            'connect_timeout' => self::CONNECT_TIMEOUT,
            'proxy' => '',
            'curl' => $pin === null ? [] : [CURLOPT_RESOLVE => [$pin]],
            'progress' => function (int|float $total, int|float $downloaded): void {
                if ($downloaded > self::RESPONSE_MAX) {
                    throw new ResponseTooLarge;
                }
            },
            'on_stats' => function (TransferStats $stats): void {
                $this->transferStats = $stats;
                $this->assertPinned($stats);
            },
        ];
    }

    /** K5: curl connected to one of the checked addresses (or to none: no connection, nothing to check). */
    private function assertPinned(TransferStats $stats): void
    {
        $ip = $stats->getHandlerStats()['primary_ip'] ?? '';
        if (! $this->target instanceof Target || ! is_string($ip) || $ip === '') {
            return;
        }

        $canonical = Addresses::isIp($ip) ? (string) inet_ntop((string) inet_pton($ip)) : $ip;
        if (! in_array($canonical, $this->target->addresses, true)) {
            report($refused = new PinnedAddressNotUsed);

            throw $refused;
        }
    }

    /**
     * Why a try has no answer (A375): the reason of a refused target, `too_large`, `timeout` (cURL 28) or `connection`,
     * then the first sentence of the error with every URL masked.
     */
    private function error(): string
    {
        $code = match (true) {
            $this->target instanceof UnsafeTarget => $this->target->reason,
            $this->errorType === ResponseTooLarge::class => 'too_large',
            preg_match('/cURL error 28\b/', (string) $this->errorMessage) === 1 => 'timeout',
            default => 'connection',
        };

        return $code.': '.Redact::text((string) $this->errorMessage);
    }
}
