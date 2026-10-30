<?php

namespace App\Models;

use App\Enums\Locale;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The one organization of the installation; its row is created by the migration.
 *
 * @property string $id
 * @property string $name
 * @property Locale $locale
 * @property string $timezone
 * @property int $week_start
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'locale', 'timezone', 'week_start'])]
final class Organization extends Model
{
    use HasUlids;

    protected $table = 'organization';

    /**
     * The organization, loaded once per request (AppServiceProvider binds it scoped).
     */
    public static function current(): self
    {
        return app(self::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'locale' => Locale::class,
            'week_start' => 'int',
        ];
    }
}
