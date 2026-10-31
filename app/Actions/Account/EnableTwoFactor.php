<?php

namespace App\Actions\Account;

use App\Access\Authorize;
use App\Events\EventRecorder;
use App\Events\EventType;
use App\Exceptions\Problem;
use App\Models\User;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;
use Laravel\Fortify\Actions\EnableTwoFactorAuthentication;
use Laravel\Fortify\Fortify;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Starts the setup of the second factor (spec 4.2, P19): a new secret and new recovery codes, both stored encrypted;
 * the second factor is on only once ConfirmTwoFactor saw the first code. A setup started before begins anew. The answer
 * carries the secret for the authenticator app (to type or as QR code); the event notes only the start (P26).
 */
final class EnableTwoFactor
{
    use AsAction;

    public function __construct(private readonly EnableTwoFactorAuthentication $enable) {}

    /**
     * @return array{secret: string, otpauth_url: string, qr_svg: string}
     *
     * @throws Problem 409 `two_factor_enabled` while the second factor is on
     */
    public function handle(Actor $actor): array
    {
        Authorize::check($actor, 'manageSignIn', User::class);
        $user = $actor->user;

        if ($user->hasEnabledTwoFactorAuthentication()) {
            throw Problem::conflict('two_factor_enabled');
        }

        DB::transaction(function () use ($actor, $user): void {
            ($this->enable)($user, force: true);
            EventRecorder::record(EventType::UserTwoFactorSetupStarted, $actor, $user, null);
        });

        return [
            'secret' => Fortify::currentEncrypter()->decrypt((string) $user->two_factor_secret),
            'otpauth_url' => $user->twoFactorQrCodeUrl(),
            'qr_svg' => 'data:image/svg+xml;base64,'.base64_encode($user->twoFactorQrCodeSvg()),
        ];
    }
}
