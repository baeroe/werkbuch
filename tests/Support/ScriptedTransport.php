<?php

namespace Tests\Support;

use Closure;
use Illuminate\Mail\MailManager;
use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;

/**
 * A mail server whose answer a test writes: every message is handed to the script with its number (from 1), which may
 * throw (a refusing server) or do something while the mail is on its way (another request). `use()` makes it the
 * mailer of the app, over a real MailManager (also after Mail::fake()), and returns it; `count()` is how many messages
 * reached it, refused ones included.
 */
final class ScriptedTransport extends AbstractTransport
{
    private int $count = 0;

    /**
     * @param  Closure(int, SentMessage): void  $script
     */
    public function __construct(private readonly Closure $script)
    {
        parent::__construct();
    }

    /**
     * @param  Closure(int, SentMessage): void  $script
     */
    public static function use(Closure $script): self
    {
        $transport = new self($script);
        Mail::swap($manager = new MailManager(app()));
        $manager->extend('scripted', fn () => $transport);
        config(['mail.mailers.scripted' => ['transport' => 'scripted'], 'mail.default' => 'scripted']);

        return $transport;
    }

    public function count(): int
    {
        return $this->count;
    }

    protected function doSend(SentMessage $message): void
    {
        ($this->script)(++$this->count, $message);
    }

    public function __toString(): string
    {
        return 'scripted://';
    }
}
