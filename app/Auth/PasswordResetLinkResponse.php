<?php

namespace App\Auth;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Laravel\Fortify\Contracts\FailedPasswordResetLinkRequestResponse;

/**
 * The answer when the broker sends no reset link. It only returns INVALID_USER (unknown address) or RESET_THROTTLED
 * (a link went out moments ago); both answer like a sent link, so the form does not reveal whether an account exists.
 */
final class PasswordResetLinkResponse implements FailedPasswordResetLinkRequestResponse
{
    public function __construct(public readonly string $status) {}

    /**
     * @param  Request  $request
     */
    public function toResponse($request): RedirectResponse
    {
        return back()->with('status', __('passwords.sent'));
    }
}
