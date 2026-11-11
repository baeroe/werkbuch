<?php

namespace Database\Seeders;

use App\Enums\Locale;
use App\Models\Organization;
use App\Models\User;
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
     * Refuses a database that holds the demo of another language: its organization bears that demo name, or (renamed
     * since) a demo person has the mail domain of that demo (T22a-M4). Refuses as well while a demo handle has any other
     * address than `{handle}@{domain}` of this demo (A2-M2): the PeopleSeeder finds the people by that address and would
     * die on the unique handle.
     */
    private static function refuseOtherLanguage(Locale $locale): void
    {
        $name = Organization::current()->name;
        $people = User::query()->whereIn('handle', PeopleSeeder::HANDLES)->orderBy('handle')->pluck('email', 'handle');

        foreach (Locale::cases() as $other) {
            $domain = '@'.DemoTexts::get('organization.mail_domain', $other);
            $mailed = $people->contains(fn (mixed $email) => is_string($email) && str_ends_with($email, $domain));
            if ($other !== $locale && ($name === DemoTexts::get('organization.name', $other) || $mailed)) {
                throw new RuntimeException("This database holds the demo data of {$name} ({$other->value}); set it up anew (migrate:fresh) before seeding the demo in {$locale->value}.");
            }
        }

        $domain = DemoTexts::get('organization.mail_domain', $locale);
        foreach ($people as $handle => $email) {
            if ($email !== "{$handle}@{$domain}") {
                throw new RuntimeException("The account @{$handle} has the address {$email}, not {$handle}@{$domain}; set the database up anew (migrate:fresh) or give it back that address before seeding the demo in {$locale->value}.");
            }
        }
    }
}
