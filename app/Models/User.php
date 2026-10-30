<?php

namespace App\Models;

use App\Enums\AccountType;
use App\Enums\Locale;
use App\Notifications\ResetPasswordNotification;
use App\Rules\ImageDataUrl;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Translation\HasLocalePreference;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\HasApiTokens;
use Spatie\MediaLibrary\HasMedia;
use Spatie\MediaLibrary\InteractsWithMedia;
use Spatie\Permission\Traits\HasRoles;

/**
 * An account: a person or a bot (spec 4.2). Its avatar is the media collection `avatar`.
 *
 * @property string $id
 * @property AccountType $type
 * @property string $name
 * @property string $handle
 * @property bool $is_default_bot
 * @property string|null $owner_id
 * @property string|null $description
 * @property string|null $email
 * @property string|null $password
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property Locale|null $locale
 * @property string|null $timezone
 * @property Carbon|null $disabled_at
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable([
    'type', 'name', 'handle', 'is_default_bot', 'owner_id', 'description', 'email', 'password', 'locale', 'timezone',
    'disabled_at', 'two_factor_secret', 'two_factor_recovery_codes', 'two_factor_confirmed_at',
])]
#[Hidden(['password', 'remember_token', 'two_factor_secret', 'two_factor_recovery_codes'])]
class User extends Authenticatable implements HasLocalePreference, HasMedia
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasRoles, HasUlids, InteractsWithMedia, Notifiable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => AccountType::class,
            'locale' => Locale::class,
            'is_default_bot' => 'boolean',
            'disabled_at' => 'datetime',
            'two_factor_confirmed_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function registerMediaCollections(): void
    {
        $this->addMediaCollection('avatar')->singleFile()->acceptsMimeTypes(ImageDataUrl::MIME_TYPES);
    }

    /**
     * The bot that acts for the system (automations, imports); the setup creates exactly one.
     */
    public static function defaultBot(): self
    {
        return self::query()->where('is_default_bot', true)->sole();
    }

    /**
     * The person who runs this bot.
     *
     * @return BelongsTo<User, $this>
     */
    public function owner(): BelongsTo
    {
        return $this->belongsTo(self::class, 'owner_id');
    }

    /**
     * The interface language of this account: its own, else the default of the organization.
     */
    public function effectiveLocale(): Locale
    {
        return $this->locale ?? Organization::current()->locale;
    }

    /**
     * The time zone of this account: its own, else the one of the organization.
     */
    public function effectiveTimezone(): string
    {
        return $this->timezone ?? Organization::current()->timezone;
    }

    /**
     * The language of notifications and mails for this account.
     */
    public function preferredLocale(): string
    {
        return $this->effectiveLocale()->value;
    }

    public function isPerson(): bool
    {
        return $this->type === AccountType::Person;
    }

    public function isBot(): bool
    {
        return $this->type === AccountType::Bot;
    }

    public function isDisabled(): bool
    {
        return $this->disabled_at !== null;
    }

    /**
     * The reset link goes only to active people, in the language of the account; for everyone else nothing goes out,
     * while the form answers the same (App\Http\Controllers\Auth\PasswordResetLinkController).
     *
     * @param  string  $token
     */
    public function sendPasswordResetNotification(#[\SensitiveParameter] $token): void
    {
        if ($this->isDisabled() || ! $this->isPerson()) {
            return;
        }

        $this->notify((new ResetPasswordNotification($token))->locale($this->preferredLocale()));
    }
}
