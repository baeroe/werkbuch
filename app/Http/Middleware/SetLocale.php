<?php

namespace App\Http\Middleware;

use App\Enums\Locale;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\Response;

/**
 * Sets the language of the request: the signed-in account's own language, else the plain `locale` cookie, else the
 * default of the organization (config until Phase 2), else English. The cookie follows the profile, so the login page
 * after a logout stays in the language of the last session.
 */
final class SetLocale
{
    public const COOKIE = 'locale';

    public static function resolve(Request $request): string
    {
        return self::profile($request)
            ?? self::cookie($request)
            ?? Locale::default()->value;
    }

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $locale = self::resolve($request);

        app()->setLocale($locale);
        Carbon::setLocale($locale);

        $before = self::profile($request);

        $response = $next($request);

        // The request may sign in, sign out or change the profile language: the cookie follows the profile as it is
        // afterwards, and keeps the language the request began with when it signed out.
        $remembered = self::profile($request) ?? $before;

        if ($remembered !== null && self::cookie($request) !== $remembered) {
            $response->headers->setCookie(cookie()->forever(self::COOKIE, $remembered));
        }

        return $response;
    }

    private static function profile(Request $request): ?string
    {
        $user = $request->user();

        return $user instanceof User ? $user->locale?->value : null;
    }

    private static function cookie(Request $request): ?string
    {
        // all(), because get() throws for a cookie sent as locale[]=…
        $value = $request->cookies->all()[self::COOKIE] ?? null;

        return is_string($value) ? Locale::tryFrom($value)?->value : null;
    }
}
