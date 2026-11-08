<?php

namespace Database\Seeders;

use App\Enums\Locale;
use App\Models\Organization;
use App\Search\SearchIndexer;
use Database\Seeders\Demo\ActivitySeeder;
use Database\Seeders\Demo\AttachmentsSeeder;
use Database\Seeders\Demo\AutomationsSeeder;
use Database\Seeders\Demo\BotsSeeder;
use Database\Seeders\Demo\CatalogSeeder;
use Database\Seeders\Demo\CommentsSeeder;
use Database\Seeders\Demo\FavoritesSeeder;
use Database\Seeders\Demo\ItemsSeeder;
use Database\Seeders\Demo\NotificationsSeeder;
use Database\Seeders\Demo\OrganizationSeeder;
use Database\Seeders\Demo\PagesSeeder;
use Database\Seeders\Demo\PeopleSeeder;
use Database\Seeders\Demo\ProjectsSeeder;
use Database\Seeders\Demo\TemplatesSeeder;
use Database\Seeders\Demo\Texts\DemoTexts;
use Database\Seeders\Demo\TokensSeeder;
use Database\Seeders\Demo\ViewsSeeder;
use Database\Seeders\Demo\WebhooksSeeder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Fictional demo data of the Feldwerk team, taken from the clickdummy. Safe to run again: every seeder updates by a
 * stable key. Each phase appends its own seeder to the list in seeders(). The search index is built anew at the end (the
 * seeders write rows directly, no event reaches the search consumer).
 *
 * The seeders keep one structure and take their texts from DemoTexts in LOCALE: German here, English in DemoSeederEn
 * (A443). One database holds one language: the seeders find catalog entries and views by their text, so both
 * languages in one database would mix them; the demo of the other language is refused before the first write.
 */
class DemoSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'werkbuch-demo';

    /** The language of the texts this seeder writes. */
    protected const LOCALE = Locale::De;

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo data must never be seeded in production.');
        }

        self::refuseOtherLanguage(static::LOCALE);
        $previous = DemoTexts::current();
        DemoTexts::use(static::LOCALE);

        try {
            $this->call($this->seeders());
        } finally {
            DemoTexts::use($previous);
        }

        app(SearchIndexer::class)->rebuild();
    }

    /**
     * @return list<class-string<Seeder>>
     */
    protected function seeders(): array
    {
        return [
            OrganizationSeeder::class,
            PeopleSeeder::class,
            BotsSeeder::class,
            CatalogSeeder::class,
            ProjectsSeeder::class,
            ViewsSeeder::class,
            FavoritesSeeder::class,
            TokensSeeder::class,
            ItemsSeeder::class,
            PagesSeeder::class,
            ActivitySeeder::class,
            CommentsSeeder::class,
            AttachmentsSeeder::class,
            // after the items its runs made; before the inbox, whose failed run names its template (K20)
            TemplatesSeeder::class,
            AutomationsSeeder::class,
            // before the inbox, whose switched-off webhook names its webhook
            WebhooksSeeder::class,
            NotificationsSeeder::class,
        ];
    }

    /**
     * Refuses a database whose organization bears the demo name of another language.
     */
    private static function refuseOtherLanguage(Locale $locale): void
    {
        $name = Organization::current()->name;

        foreach (Locale::cases() as $other) {
            if ($other !== $locale && $name === DemoTexts::get('organization.name', $other)) {
                throw new RuntimeException("This database holds the demo data of {$name} ({$other->value}); set it up anew (migrate:fresh) before seeding the demo in {$locale->value}.");
            }
        }
    }
}
