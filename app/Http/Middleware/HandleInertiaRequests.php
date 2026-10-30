<?php

namespace App\Http\Middleware;

use App\Access\Grants;
use App\Access\Permission;
use App\Access\Visibility;
use App\Http\Resources\OrganizationResource;
use App\Http\Resources\UserResource;
use App\Models\Organization;
use App\Models\User;
use App\Support\MailSetup;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Inertia\Inertia;
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
        $locale = app()->getLocale();
        $account = $user instanceof User ? $user : null;

        return [
            ...parent::share($request),
            'auth' => [
                // the account as the API shows it, and the rights it holds in the organization (lib/permissions.ts)
                'user' => $account === null ? null : (new UserResource($account))->resolve($request),
                'permissions' => $account === null ? [] : array_map(fn (Permission $p) => $p->value, Grants::of(Visibility::orgRole($account))),
            ],
            // the language of this request and its texts; they travel once, a change of language reloads the page
            'locale' => $locale,
            'translations' => Inertia::once(fn () => File::json(lang_path("{$locale}.json"))),
            'organization' => (new OrganizationResource(Organization::current()))->resolve($request),
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
}
