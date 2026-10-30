<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Support\MailSetup;
use Illuminate\Http\Request;
use Inertia\Middleware;

/**
 * The props every Inertia page carries (the contract of resources/js/lib/page.ts `SharedProps`).
 */
class HandleInertiaRequests extends Middleware
{
    /**
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $user = $request->user();

        return [
            ...parent::share($request),
            'auth' => [
                'user' => $user instanceof User ? $this->account($user) : null,
                // roles and permissions arrive with Phase 2
                'permissions' => [],
            ],
            // from the config until the organization is a record (Phase 2)
            'organization' => [
                'name' => config('app.name'),
                'locale' => config('app.locale'),
                'timezone' => config('app.timezone'),
                'week_start' => 1,
                'logo_url' => null,
            ],
            'features' => [
                'mail' => MailSetup::configured(),
                // the live connection (Reverb) is wired up in Phase 8
                'live' => null,
            ],
            'flash' => [
                'status' => $request->session()->get('status'),
                'error' => $request->session()->get('error'),
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function account(User $user): array
    {
        return [
            'id' => $user->id,
            'type' => $user->type->value,
            'name' => $user->name,
            'handle' => $user->handle,
            'email' => $user->email,
            'locale' => $user->locale?->value,
            'timezone' => $user->timezone,
            // avatars arrive with Phase 2
            'avatar_url' => null,
        ];
    }
}
