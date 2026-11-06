<?php

namespace App\Actions\Users;

use App\Models\User;
use App\Support\Actor;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * The account of the request: the person or bot of the session or of the token (A392), so a bot learns who it is. A
 * read token may ask it. MeResource adds the rights of its role in the organization.
 */
final class GetMe
{
    use AsAction;

    public function handle(Actor $actor): User
    {
        return $actor->user->load('media');
    }
}
