<?php

use App\Models\Page;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Search Engine
    |--------------------------------------------------------------------------
    |
    | This option controls the default search connection that gets used while
    | using Laravel Scout. This connection is used when syncing all models
    | to the search service. You should adjust this based on your needs.
    |
    | Supported: "algolia", "meilisearch", "typesense", "turbopuffer",
    |            "database", "collection", "null"
    |
    | werkbuch: Meilisearch, through App\Search\MeilisearchEngine (AppServiceProvider). Tests run with "null" and
    | switch to the engine in memory (searchEngine()) or to real Meilisearch (Tests\Support\Meili).
    |
    */

    'driver' => env('SCOUT_DRIVER', 'meilisearch'),

    /*
    |--------------------------------------------------------------------------
    | Index Prefix
    |--------------------------------------------------------------------------
    |
    | Here you may specify a prefix that will be applied to all search index
    | names used by Scout. This prefix may be useful if you have multiple
    | "tenants" or applications sharing the same search infrastructure.
    |
    | werkbuch: empty in the app; the tests use `testing_` (phpunit.xml), so they never empty the index of the app.
    | The models keep Scout's searchableAs(): the prefix and the name of the table.
    |
    */

    'prefix' => env('SCOUT_PREFIX', ''),

    /*
    |--------------------------------------------------------------------------
    | Queue Data Syncing
    |--------------------------------------------------------------------------
    |
    | This option allows you to control if the operations that sync your data
    | with your search engines are queued. When this is set to "true" then
    | all automatic data syncing will get queued for better performance.
    |
    | werkbuch: off. Scout's model observers are off as well (AppServiceProvider): only the search consumer writes the
    | index, and it already runs in the queue `search`.
    |
    */

    'queue' => false,

    /*
    |--------------------------------------------------------------------------
    | Database Transactions
    |--------------------------------------------------------------------------
    |
    | This configuration option determines if your data will only be synced
    | with your search indexes after every open database transaction has
    | been committed, thus preventing any discarded data from syncing.
    |
    */

    'after_commit' => false,

    /*
    |--------------------------------------------------------------------------
    | Chunk Sizes
    |--------------------------------------------------------------------------
    |
    | These options allow you to control the maximum chunk size when you are
    | mass importing data into the search engine. This allows you to fine
    | tune each of these chunk sizes based on the power of the servers.
    |
    */

    'chunk' => [
        'searchable' => 500,
        'unsearchable' => 500,
    ],

    /*
    |--------------------------------------------------------------------------
    | Soft Deletes
    |--------------------------------------------------------------------------
    |
    | This option allows to control whether to keep soft deleted records in
    | the search indexes. Maintaining soft deleted records can be useful
    | if your application still needs to search for the records later.
    |
    */

    'soft_delete' => false,

    /*
    |--------------------------------------------------------------------------
    | Identify User
    |--------------------------------------------------------------------------
    |
    | This option allows you to control whether to notify the search engine
    | of the user performing the search. This is sometimes useful if the
    | engine supports any analytics based on this application's users.
    |
    | Supported engines: "algolia"
    |
    */

    'identify' => false,

    /*
    |--------------------------------------------------------------------------
    | Algolia Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your Algolia settings. Algolia is a cloud hosted
    | search engine which works great with Scout out of the box. Just plug
    | in your application ID and admin API key to get started searching.
    |
    */

    'algolia' => [
        'id' => env('ALGOLIA_APP_ID', ''),
        'secret' => env('ALGOLIA_SECRET', ''),
        'index-settings' => [
            // 'users' => [
            //     'searchableAttributes' => ['id', 'name', 'email'],
            //     'attributesForFaceting'=> ['filterOnly(email)'],
            // ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Meilisearch Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your Meilisearch settings. Meilisearch is an open
    | source search engine with minimal configuration. Below, you can state
    | the host and key information for your own Meilisearch installation.
    |
    | See: https://www.meilisearch.com/docs/learn/configuration/instance_options#all-instance-options
    |
    */

    'meilisearch' => [
        'host' => env('MEILISEARCH_HOST', 'http://localhost:7700'),
        'key' => env('MEILISEARCH_KEY'),
        // the order of searchableAttributes is their weight; who may see what is filtered when searching (project_id,
        // id), never stored in the index
        'index-settings' => [
            WorkItem::class => [
                'searchableAttributes' => ['key', 'title', 'description', 'comments'],
                // type_id, state_category, assignee_id (also IS NULL) and label_ids filter the items of the search
                // (`QuerySearch::FILTERS`, phase 13); filterable since phase 6 (A206), no new settings to sync
                'filterableAttributes' => ['project_id', 'archived', 'type_id', 'state_category', 'assignee_id', 'label_ids'],
                'rankingRules' => ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'updated_at:desc'],
                'typoTolerance' => ['disableOnAttributes' => ['key']],
            ],
            Page::class => [
                'searchableAttributes' => ['title', 'text'],
                'filterableAttributes' => ['project_id'],
                'rankingRules' => ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness', 'updated_at:desc'],
            ],
            Project::class => [
                'searchableAttributes' => ['identifier', 'former_identifiers', 'name', 'description'],
                'filterableAttributes' => ['id', 'archived'],
                'typoTolerance' => ['disableOnAttributes' => ['identifier', 'former_identifiers']],
            ],
            User::class => [
                'searchableAttributes' => ['name', 'handle'],
                'filterableAttributes' => ['disabled', 'type'],
                'typoTolerance' => ['disableOnAttributes' => ['handle']],
            ],
        ],
        'model-settings' => [
            // User::class => [
            //     'embedding' => [
            //         'embedder' => 'default',
            //         'dimensions' => 1536,
            //     ],
            // ],
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Typesense Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your Typesense settings. Typesense is an open
    | source search engine using minimal configuration. Below, you will
    | state the host, key, and schema configuration for the instance.
    |
    */

    'typesense' => [
        'client-settings' => [
            'api_key' => env('TYPESENSE_API_KEY', 'xyz'),
            'nodes' => [
                [
                    'host' => env('TYPESENSE_HOST', 'localhost'),
                    'port' => env('TYPESENSE_PORT', '8108'),
                    'path' => env('TYPESENSE_PATH', ''),
                    'protocol' => env('TYPESENSE_PROTOCOL', 'http'),
                ],
            ],
            'nearest_node' => [
                'host' => env('TYPESENSE_HOST', 'localhost'),
                'port' => env('TYPESENSE_PORT', '8108'),
                'path' => env('TYPESENSE_PATH', ''),
                'protocol' => env('TYPESENSE_PROTOCOL', 'http'),
            ],
            'connection_timeout_seconds' => env('TYPESENSE_CONNECTION_TIMEOUT_SECONDS', 2),
            'healthcheck_interval_seconds' => env('TYPESENSE_HEALTHCHECK_INTERVAL_SECONDS', 30),
            'num_retries' => env('TYPESENSE_NUM_RETRIES', 3),
            'retry_interval_seconds' => env('TYPESENSE_RETRY_INTERVAL_SECONDS', 1),
        ],
        // 'max_total_results' => env('TYPESENSE_MAX_TOTAL_RESULTS', 1000),
        'model-settings' => [
            // User::class => [
            //     'collection-schema' => [
            //         'fields' => [
            //             [
            //                 'name' => 'id',
            //                 'type' => 'string',
            //             ],
            //             [
            //                 'name' => 'name',
            //                 'type' => 'string',
            //             ],
            //             [
            //                 'name' => 'created_at',
            //                 'type' => 'int64',
            //             ],
            //         ],
            //         'default_sorting_field' => 'created_at',
            //     ],
            //     'search-parameters' => [
            //         'query_by' => 'name'
            //     ],
            //     'embedding' => [
            //         'attribute' => 'embedding',
            //         'dimensions' => 1536,
            //     ],
            // ],
        ],
        'import_action' => env('TYPESENSE_IMPORT_ACTION', 'upsert'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Turbopuffer Configuration
    |--------------------------------------------------------------------------
    |
    | Here you may configure your Turbopuffer connection and the schema and
    | searchable attributes defined by each of your application's models.
    | Turbopuffer is a scalable engine with full-text + vector search.
    |
    */

    'turbopuffer' => [
        'api_key' => env('TURBOPUFFER_API_KEY'),
        'region' => env('TURBOPUFFER_REGION', 'gcp-us-central1'),
        'base_url' => env('TURBOPUFFER_BASE_URL'),
        'timeout' => env('TURBOPUFFER_TIMEOUT', 60),
        'connect_timeout' => env('TURBOPUFFER_CONNECT_TIMEOUT', 5),
        'retries' => env('TURBOPUFFER_RETRIES', 3),
        'model-settings' => [
            // User::class => [
            //     'searchable-attributes' => [
            //         'name' => 2,
            //         'email' => 1,
            //     ],
            //     'embedding' => [
            //         'attribute' => 'embedding',
            //         'dimensions' => 1536,
            //     ],
            //     'schema' => [
            //         'name' => ['type' => 'string', 'full_text_search' => true],
            //         'email' => ['type' => 'string', 'full_text_search' => true],
            //         'embedding' => ['type' => '[1536]f32', 'ann' => true],
            //     ],
            // ],
        ],
    ],

];
