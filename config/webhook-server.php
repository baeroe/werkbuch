<?php

use App\Domain\Webhooks\Backoff;
use App\Jobs\DeliverWebhook;
use App\Webhooks\WebhookBackoff;
use Spatie\WebhookServer\Signer\DefaultSigner;

/*
 * spatie/laravel-webhook-server 4 (phase 11, K1). Every webhook job comes out of WebhookCall::create(), which reads this
 * file: a call to useJob() after create() would throw the configured job away, so the job, its queue and the retries
 * stand here. The job signs each attempt itself (`X-Werkbuch-Signature` with a fresh timestamp), so spatie's signer
 * and its `Webhook-Id` header stay unused.
 */
return [

    /*
     *  The default queue that should be used to send webhook requests.
     */
    'queue' => 'webhooks',

    /*
     *  The default queue connection that should be used to send webhook requests.
     */
    'connection' => null,

    /*
     * The default http verb to use.
     */
    'http_verb' => 'post',

    /*
     * Proxies to use for request. Never one: a proxy resolves the host itself and passes the address check by (K4).
     *
     * See https://docs.guzzlephp.org/en/stable/request-options.html#proxy
     */
    'proxy' => null,

    /*
     * This class is responsible for calculating the signature that will be added to
     * the headers of the webhook request. A webhook client can use the signature
     * to verify the request hasn't been tampered with.
     */
    'signer' => DefaultSigner::class,

    /*
     * This is the name of the header where the signature will be added.
     */
    'signature_header_name' => 'Signature',

    /*
     * This is the name of the header where the timestamp will be added.
     */
    'timestamp_header_name' => 'Timestamp',

    /*
     * Send the webhook UUID in this header. Set to null to disable it: `X-Werkbuch-Delivery` names the delivery.
     */
    'webhook_id_header_name' => null,

    /*
     * These are the headers that will be added to all webhook requests.
     */
    'headers' => [
        'Content-Type' => 'application/json',
    ],

    /*
     * If a call to a webhook takes longer this amount of seconds
     * the attempt will be considered failed.
     */
    'timeout_in_seconds' => 10,

    /*
     * The amount of times the webhook should be called before we give up.
     */
    'tries' => Backoff::TRIES,

    /*
     * This class determines how many seconds there should be between attempts (Backoff::OFFSETS).
     */
    'backoff_strategy' => WebhookBackoff::class,

    /*
     * Retry all unsuccessful HTTP statuses by default. Set an array to limit them.
     * Connection failures are still retried.
     */
    'retryable_status_codes' => null,

    /*
     * Use the response's Retry-After header as a minimum retry delay.
     */
    'respect_retry_after' => false,

    /*
     * Randomize the backoff delay between zero and the strategy's delay.
     */
    'retry_with_jitter' => false,

    /*
     * This class is used to dispatch webhooks onto the queue.
     */
    'webhook_job' => DeliverWebhook::class,

    /*
     * By default we will verify that the ssl certificate of the destination
     * of the webhook is valid.
     */
    'verify_ssl' => true,

    /*
     * When set to true, an exception will be thrown when the last attempt fails. Never: a receiver that fails is no
     * failed job (nothing lands in `failed_jobs`).
     */
    'throw_exception_on_failure' => false,

    /*
     * When using Laravel Horizon you can specify tags that should be used on the
     * underlying job that performs the webhook request.
     */
    'tags' => [],
];
