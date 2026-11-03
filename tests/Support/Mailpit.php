<?php

namespace Tests\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Real Mailpit for tests/Integration (the DDEV service, the CI service of the job `tests`): mail goes out over SMTP on
 * 127.0.0.1:1025, the API answers on MAILPIT_URL (phpunit.xml). DDEV, e2e and development share the instance (K17):
 * nothing here empties it. A test sends to an address of its own (address()), reads only what went there, and forgets
 * only its own messages afterwards.
 */
final class Mailpit
{
    /** Switches the mailer to Mailpit's SMTP. */
    public static function use(): void
    {
        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp' => [...config('mail.mailers.smtp'), 'scheme' => null, 'host' => '127.0.0.1', 'port' => 1025, 'username' => null, 'password' => null],
        ]);
        Mail::forgetMailers();
    }

    /** An address nobody else sends to. */
    public static function address(): string
    {
        return 'mailpit-'.Str::uuid().'@example.com';
    }

    /**
     * The summaries of the messages to the address (`ID`, `Subject`, …), newest first; waits up to 5 s for the first.
     *
     * @return list<array<string, mixed>>
     */
    public static function messagesTo(string $email): array
    {
        $until = microtime(true) + 5;
        do {
            /** @var list<array<string, mixed>> $messages */
            $messages = Http::get(self::url('/api/v1/search'), ['query' => "to:\"{$email}\""])->throw()->json('messages') ?? [];
            if ($messages !== [] || microtime(true) > $until) {
                return $messages;
            }
            usleep(50_000);
        } while (true);
    }

    /**
     * The whole message (`HTML`, `Text`, `Attachments`, `Inline`, …).
     *
     * @return array<string, mixed>
     */
    public static function message(string $id): array
    {
        $message = Http::get(self::url("/api/v1/message/{$id}"))->throw()->json();
        if (! is_array($message)) {
            throw new RuntimeException("Mailpit has no message {$id}.");
        }

        return $message;
    }

    /** The HTML part of the message. */
    public static function html(string $id): string
    {
        return (string) self::message($id)['HTML'];
    }

    /** The plain text part of the message. */
    public static function text(string $id): string
    {
        return (string) self::message($id)['Text'];
    }

    /**
     * Deletes the messages, and only them.
     *
     * @param  list<string>  $ids
     */
    public static function forget(array $ids): void
    {
        if ($ids !== []) {
            Http::send('DELETE', self::url('/api/v1/messages'), ['json' => ['IDs' => $ids]])->throw();
        }
    }

    private static function url(string $path): string
    {
        return rtrim((string) env('MAILPIT_URL', 'http://127.0.0.1:8025'), '/').$path;
    }
}
