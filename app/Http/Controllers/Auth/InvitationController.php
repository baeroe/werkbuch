<?php

namespace App\Http\Controllers\Auth;

use App\Actions\Auth\AcceptInvitation;
use App\Actions\Auth\CheckInvitation;
use App\Enums\InvitationState;
use App\Http\Controllers\Controller;
use App\Models\Invitation;
use App\Models\Organization;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/**
 * The page of an invitation link and its form (routes/auth.php, signed and for guests). An unknown id is a closed link,
 * not a 404: a replaced invitation is gone from the table, and its link must say so like any other that no longer works.
 */
final class InvitationController extends Controller
{
    public function show(string $invitation): Response
    {
        $found = Invitation::query()->find($invitation);
        $state = CheckInvitation::run($found);

        // the address only goes to a link that can be accepted
        return Inertia::render('Auth/Invitation', [
            'state' => $state->value,
            'email' => $state === InvitationState::Open ? $found?->email : null,
        ]);
    }

    public function accept(Request $request, string $invitation): RedirectResponse
    {
        $user = AcceptInvitation::run(Invitation::query()->find($invitation), $request->only(['name', 'password']));

        Auth::guard((string) config('fortify.guard'))->login($user);
        $request->session()->regenerate();

        return redirect('/my-items')->with('status', __('invitation.welcome', ['name' => $user->name, 'organization' => Organization::current()->name]));
    }
}
