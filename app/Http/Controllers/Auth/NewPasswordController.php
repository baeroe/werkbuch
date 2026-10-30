<?php

namespace App\Http\Controllers\Auth;

use Illuminate\Contracts\Support\Responsable;
use Illuminate\Http\Request;
use Laravel\Fortify\Http\Controllers\NewPasswordController as FortifyNewPasswordController;

/**
 * POST /reset-password: Fortify's reset, but token and address have to be text first. Fortify lowers the address before
 * it validates, and the broker compares the token against its hash: an array in either field would end in a 500.
 */
final class NewPasswordController extends FortifyNewPasswordController
{
    public function store(Request $request): Responsable
    {
        $request->validate(['token' => ['required', 'string'], 'email' => ['required', 'string']]);

        return parent::store($request);
    }
}
