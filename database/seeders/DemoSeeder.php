<?php

namespace Database\Seeders;

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
use Database\Seeders\Demo\TokensSeeder;
use Database\Seeders\Demo\ViewsSeeder;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Fictional demo data of the Feldwerk team, taken from the clickdummy. Safe to run again: every seeder updates by a
 * stable key. Each phase appends its own seeder to the list in run(). The search index is built anew at the end (the
 * seeders write rows directly, no event reaches the search consumer).
 */
class DemoSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'werkbuch-demo';

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The demo data must never be seeded in production.');
        }

        $this->call([
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
            NotificationsSeeder::class,
        ]);

        app(SearchIndexer::class)->rebuild();
    }
}
