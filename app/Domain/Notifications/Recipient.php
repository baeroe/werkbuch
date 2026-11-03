<?php

namespace App\Domain\Notifications;

/** A person an event concerns, with every kind that applies to them, the strongest first (A267). */
final readonly class Recipient
{
    /**
     * @param  list<NotificationKind>  $kinds
     */
    public function __construct(
        public string $userId,
        public array $kinds,
    ) {}
}
