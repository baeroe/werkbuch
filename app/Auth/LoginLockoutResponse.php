<?php

namespace App\Auth;

use App\Exceptions\Rendering;
use Illuminate\Validation\ValidationException;
use Laravel\Fortify\Fortify;
use Laravel\Fortify\Http\Responses\LockoutResponse;

/**
 * Fortify's answer to a locked sign-in, with the wait in minutes from two minutes on (the cap per account lasts up to an
 * hour). The exception only carries the finished sentence, so the choice happens here, through Rendering::throttleMessage.
 */
final class LoginLockoutResponse extends LockoutResponse
{
    public function toResponse($request)
    {
        throw ValidationException::withMessages([
            Fortify::username() => [Rendering::throttleMessage((int) $this->limiter->availableIn($request))],
        ])->status(429);
    }
}
