<?php

namespace App\Support;

/**
 * Whether the instance can really send mail: false for the mailers that only keep or log messages (`log`, `array`),
 * so the UI can hide features that need an inbox (password reset by mail, notification mails).
 */
final class MailSetup
{
    public static function configured(): bool
    {
        return ! in_array(config('mail.default'), ['log', 'array'], true);
    }
}
