<?php

namespace App\Domain\Notifications;

/** Where a notification reaches a person (spec 4.14): the inbox of the app or a mail. */
enum Channel: string
{
    case Inbox = 'inbox';
    case Mail = 'mail';
}
