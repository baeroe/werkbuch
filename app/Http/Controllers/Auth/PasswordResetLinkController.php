<?php

namespace App\Http\Controllers\Auth;

use App\Actions\Auth\RequestPasswordReset;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * POST /forgot-password: every valid address gets the same answer at once; the link goes out in a job.
 */
final class PasswordResetLinkController extends Controller
{
    public function store(Request $request): RedirectResponse
    {
        $request->validate(['email' => ['required', 'string', 'email']]);

        RequestPasswordReset::run($request->string('email')->value());

        return back()->with('status', __('passwords.sent'));
    }
}
