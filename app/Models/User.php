<?php

namespace App\Models;

use App\Enums\AccountType;
use App\Enums\Locale;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property AccountType $type
 * @property string $name
 * @property string $handle
 * @property string|null $email
 * @property string|null $password
 * @property Locale|null $locale
 * @property string|null $timezone
 * @property Carbon|null $disabled_at
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['type', 'name', 'handle', 'email', 'password', 'locale', 'timezone', 'disabled_at'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, HasUlids, Notifiable;

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
            'disabled_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function isPerson(): bool
    {
        return $this->type === AccountType::Person;
    }

    public function isDisabled(): bool
    {
        return $this->disabled_at !== null;
    }
}
