<?php

namespace App\Support;

use App\Exceptions\Problem;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * The account a `user_id` of the token routes names (`filter[user_id]` of the list, `user_id` of creating): the ULID in
 * any case, 404 for an unknown one and for anything that is no ULID, else the actor's own account. It only reads, the
 * callers authorize.
 */
final class TokenOwner
{
    /**
     * @throws Problem 404
     */
    public static function of(mixed $id, Actor $actor): User
    {
        if ($id === null) {
            return $actor->user;
        }

        $id = Ids::normalize($id);

        return is_string($id) && Str::isUlid($id) ? (User::query()->find($id) ?? throw Problem::notFound()) : throw Problem::notFound();
    }
}
