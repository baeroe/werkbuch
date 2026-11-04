<?php

namespace App\Broadcasting;

use App\Models\User;

/**
 * `user.{userId}` (presence, A280): notifications and the own watching of an account, only for that active person.
 * Presence, because Reverb ends connections only by the user id in their presence data (A281): the answer names it.
 */
final class UserChannel
{
    /**
     * @return array{id: string}|false
     */
    public function join(User $user, string $id): array|false
    {
        if (! $user->isPerson() || $user->isDisabled() || $id !== $user->id) {
            return false;
        }

        return ['id' => $user->id];
    }
}
