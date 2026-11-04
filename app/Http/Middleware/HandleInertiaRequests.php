<?php

namespace App\Http\Middleware;

use App\Access\Grants;
use App\Access\Permission;
use App\Access\Visibility;
use App\Http\Resources\OrganizationResource;
use App\Http\Resources\UserResource;
use App\Models\Attachment;
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
                // what the browser needs to open the WebSocket; null without Reverb (A285) and while its key or host is
                // missing from the environment (T2-M3: the browser would connect nowhere)
                'live' => config('broadcasting.default') === 'reverb' && filled(config('broadcasting.connections.reverb.key'))
                    && filled(config('broadcasting.connections.reverb.options.host')) ? [
                    'key' => config('broadcasting.connections.reverb.key'),
                    'host' => config('broadcasting.connections.reverb.options.host'),
                    'port' => (int) config('broadcasting.connections.reverb.options.port'),
                    'scheme' => config('broadcasting.connections.reverb.options.scheme'),
                ] : null,
                // the browser refuses a larger file before it sends it (F29)
                'attachments_max_mb' => Attachment::maxMegabytes(),
            ],
            'flash' => [
                'status' => $request->session()->get('status'),
                'error' => $request->session()->get('error'),
            ],
        ];
    }
}
