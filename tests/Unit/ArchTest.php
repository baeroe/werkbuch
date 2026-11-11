<?php

use App\Access\Authorize;
use App\Access\RoleAssignments;
use App\Auth\TwoFactorDay;
use App\Domain\Ulid;
use App\Events\EventRecorder;
use App\Exceptions\Problem;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Model;
use Lorisleiva\Actions\Concerns\AsAction;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

arch('php preset')->preset()->php();
// TwoFactorDay rebuilds the md5 cache key of Laravel's throttle middleware, which is no security use of md5
arch('security preset')->preset()->security()->ignoring(TwoFactorDay::class);
arch('no debugging leftovers')->expect(['dd', 'ddd'])->not->toBeUsed(); // the php preset forbids dump, ray, var_dump, print_r, die
arch('models are Eloquent models')->expect('App\Models')->toExtend(Model::class);
arch('enums are string backed')->expect('App\Enums')->toBeStringBackedEnums();
arch('actions are final, use AsAction and run through handle()')
    ->expect('App\Actions')->classes()->toBeFinal()->toUseTrait(AsAction::class)->toHaveMethod('handle');
arch('the domain is plain PHP')
    ->expect('App\Domain')->not->toUse(['Illuminate', 'Carbon', 'App\Models', 'App\Actions', 'App\Http', 'App\Support', 'App\Exceptions']);
arch('filters, displays and the calendar are plain PHP')
    ->expect(['App\Domain\Filter', 'App\Domain\Views', 'App\Domain\Time'])->not->toUse(['Illuminate', 'Carbon']);
arch('views translate into queries and write nothing')
    ->expect('App\Views')->classes()->toBeFinal()->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\Schema']);
arch('search turns models into documents and writes nothing')
    ->expect('App\Search')->classes()->toBeFinal()
    ->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\DB', 'Illuminate\Support\Facades\Schema']);
arch('webhooks build payloads and targets, record nothing and leave the database to actions')
    ->expect('App\Webhooks')->classes()->toBeFinal()
    ->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\DB', 'Illuminate\Support\Facades\Schema']);
arch('the consumer of notifications hands every event to its action and computes nothing')
    ->expect('App\Notifications\NotificationConsumer')->toBeFinal()
    ->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\DB', 'App\Domain', 'App\Models\Notification']);
arch('live tells the channels, records nothing and computes nothing')
    ->expect('App\Live')->classes()->toBeFinal()->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\Schema', 'App\Domain']);
arch('in App\Live only NotificationsChanged speaks to the database, to wait for the commit')
    ->expect(['App\Live\LiveConsumer', 'App\Live\LiveMessage', 'App\Live\Disconnect', 'App\Live\Broadcasts'])
    ->not->toUse('Illuminate\Support\Facades\DB');
arch('the live channels decide only through the policies')
    ->expect('App\Broadcasting')->classes()->toBeFinal()->toHaveMethod('join')
    ->toOnlyUse([Authorize::class, Actor::class, 'App\Models\User', 'App\Models\Project', 'App\Models\WorkItem', Ulid::class]);
arch('the OpenAPI layer is final and leaves the database and the events alone')
    ->expect('App\OpenApi')->classes()->toBeFinal()->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\DB']);
arch('the MCP layer is final but for the abstract bases of its tools and references')
    ->expect('App\Mcp')->classes()->toBeFinal()
    ->ignoring(['App\Mcp\Support\WerkbuchTool', 'App\Mcp\Support\ReadTool', 'App\Mcp\Support\WriteTool', 'App\Mcp\Resources\DocReference']);
arch('the bases of the MCP tools are abstract')
    ->expect(['App\Mcp\Support\WerkbuchTool', 'App\Mcp\Support\ReadTool', 'App\Mcp\Support\WriteTool', 'App\Mcp\Resources\DocReference'])->toBeAbstract();
arch('the MCP layer leaves the database, the schema and the events to actions')
    ->expect('App\Mcp')->not->toUse([EventRecorder::class, 'Illuminate\Support\Facades\DB', 'Illuminate\Support\Facades\Schema', 'Illuminate\Database\ConnectionInterface']);
arch('domain classes are final')->expect('App\Domain')->classes()->toBeFinal();
arch('rich text is final and leaves actions, http and the database alone')
    ->expect('App\RichText')->classes()->toBeFinal()->not->toUse(['App\Actions', 'App\Http', 'Illuminate\Support\Facades\DB']);
arch('http, console and jobs leave the database to actions')
    ->expect(['App\Http', 'App\Console', 'App\Jobs', 'App\Auth'])->not->toUse('Illuminate\Support\Facades\DB');
arch('the problem is final')->expect(Problem::class)->toBeFinal()->toExtend(RuntimeException::class)->toImplement(HttpExceptionInterface::class);
arch('api layer classes are final')->expect('App\\Http\\Api')->classes()->toBeFinal();
arch('models never call actions')->expect('App\Models')->not->toUse('App\Actions');
arch('auth adapters are final and do not compute')->expect('App\Auth')->classes()->toBeFinal()->not->toUse('App\Domain');
arch('only actions record events')->expect(EventRecorder::class)->toOnlyBeUsedIn(['App\Actions', 'Tests']);
arch('role assignments only in actions')
    ->expect(RoleAssignments::class)->toOnlyBeUsedIn(['App\Actions', 'Database\Seeders', 'Database\Factories', 'Tests']);

it('detects raw database writes', function () {
    $code = "<?php\nDB::table('users')->update([]);\nDB::table('users')->where('a', 1)->delete();\nDB::statement('x');\nDB::table('users')->get();";
    expect(rawWrites($code))->toBe(['code:2', 'code:3', 'code:4']);
});

it('detects raw writes through a connection, over several lines and past closures', function () {
    $code = <<<'PHP'
        <?php
        DB::connection('mariadb')->table('users')->update([]);
        DB::table('users')
            ->where(fn ($query) => $query->where('a', 1))
            ->delete();
        DB::table('users')->where(function ($query) {
            $query->where('a', 1);
        })->increment('logins');
        DB::connection()->statement('x');
        DB::connection('mariadb')->table('users')->where(fn ($query) => $query->whereIn('id', [1]))->get();
        DB::table('users')->get(); $user->update([]);
        PHP;

    expect(rawWrites($code))->toBe(['code:2', 'code:3', 'code:6', 'code:9']);
});

it('writes the database raw only inside app/Actions', function () {
    $hits = collect(appFiles('app'))->reject(fn (string $f) => str_starts_with($f, 'app/Actions/'))
        // sets the isolation level of the session for a transaction, writes no data (N1)
        ->reject(fn (string $f) => $f === 'app/Support/ReadCommitted.php')
        ->flatMap(fn (string $f) => rawWrites((string) file_get_contents(repo_path($f)), $f))->all();
    expect($hits)->toBe([]);
});

it('detects model writes', function () {
    expect(modelWrites("<?php\n\$user->save();\n\$this->set->handle(\$u);\nUser::create([]);\nWorkItemSchemas::create();\nWorkItem::create([]);"))->toBe(['code:2', 'code:4', 'code:6']);
});

it('never writes models in controllers, middleware, commands, jobs, auth adapters or MCP', function () {
    expect(appFiles('app/Mcp'))->not->toBe([]);

    $hits = collect(['app/Http', 'app/Console', 'app/Jobs', 'app/Auth', 'app/Mcp'])->flatMap(fn ($d) => appFiles($d))
        ->flatMap(fn (string $f) => modelWrites((string) file_get_contents(repo_path($f)), $f))->all();
    expect($hits)->toBe([]);
});

// a tool opens no transaction around an action: the deletions set READ COMMITTED themselves, and only outside a transaction (T8b-I2)
$transactions = fn (string $code, string $file = 'code'): array => collect(explode("\n", $code))
    ->filter(fn (string $line) => preg_match('/transaction\s*\(|beginTransaction|->getConnection\s*\(/i', $line) === 1)
    ->keys()->map(fn (int $index) => $file.':'.($index + 1))->values()->all();

it('detects transactions', function () use ($transactions) {
    expect($transactions("<?php\n\$x->transaction(fn () => 1);\n\$y->beginTransaction();\n\$m->getConnection();\n\$ok->run();"))->toBe(['code:2', 'code:3', 'code:4']);
});

it('never opens a transaction or takes a connection in MCP', function () use ($transactions) {
    $hits = collect(appFiles('app/Mcp'))->flatMap(fn (string $f) => $transactions((string) file_get_contents(repo_path($f)), $f))->all();

    expect($hits)->toBe([]);
});

// the session has a TransientToken, whose can() says yes to everything: an ability is checked at the
// PersonalAccessToken itself (`$token instanceof PersonalAccessToken && $token->can($x)`), never through tokenCan() (K2)
$tokenCans = fn (string $code, string $file = 'code'): array => collect(explode("\n", $code))
    ->filter(fn (string $line) => preg_match('/->tokenCan\s*\(/', $line) === 1)
    ->keys()->map(fn (int $index) => $file.':'.($index + 1))->values()->all();

it('detects tokenCan()', function () use ($tokenCans) {
    expect($tokenCans("<?php\n\$user->tokenCan('mcp');\n\$token->can('mcp');\n\$request->user()?->tokenCan ('read');"))->toBe(['code:2', 'code:4']);
});

it('never asks tokenCan() in MCP and its door', function () use ($tokenCans) {
    $files = [...appFiles('app/Mcp'), 'app/Http/Middleware/EnsureMcpToken.php'];
    $hits = collect($files)->flatMap(fn (string $f) => $tokenCans((string) file_get_contents(repo_path($f)), $f))->all();

    expect($hits)->toBe([]);
});

it('detects inserts', function () {
    expect(inserts("<?php\n\$query->insert([]);\n\$query->get();\n\$query->insertOrIgnore([]);\n\$query->upsert([], []);"))->toBe(['code:2', 'code:4', 'code:5']);
});

it('only reads in app/Views', function () {
    $hits = collect(appFiles('app/Views'))
        ->flatMap(fn (string $f) => [...modelWrites((string) file_get_contents(repo_path($f)), $f), ...inserts((string) file_get_contents(repo_path($f)), $f)])
        ->all();

    expect(appFiles('app/Views'))->not->toBe([])
        ->and($hits)->toBe([]);
});

// the index is written through Scout's engine only (searchable(), unsearchable(), flush, settings, removeWhere): no model
// write, no insert, as in app/Views (K5)
it('keeps App\Search free of writes', function () {
    $hits = collect(appFiles('app/Search'))
        ->flatMap(fn (string $f) => [...modelWrites((string) file_get_contents(repo_path($f)), $f), ...inserts((string) file_get_contents(repo_path($f)), $f)])
        ->all();

    expect(appFiles('app/Search'))->not->toBe([])
        ->and($hits)->toBe([]);
});

// App\Webhooks reads (payloads, targets) and hands every write to an action (phase plan 11, Global Constraints)
it('keeps App\Webhooks free of writes', function () {
    $hits = collect(appFiles('app/Webhooks'))
        ->flatMap(fn (string $f) => [...modelWrites((string) file_get_contents(repo_path($f)), $f), ...inserts((string) file_get_contents(repo_path($f)), $f)])
        ->all();

    expect(appFiles('app/Webhooks'))->not->toBe([])
        ->and($hits)->toBe([]);
});

// App\Live only reads (who lost access) and broadcasts: no model write, no insert (phase plan 8, Global Constraints)
it('keeps App\Live free of writes', function () {
    $hits = collect(appFiles('app/Live'))
        ->flatMap(fn (string $f) => [...modelWrites((string) file_get_contents(repo_path($f)), $f), ...inserts((string) file_get_contents(repo_path($f)), $f)])
        ->all();

    expect(appFiles('app/Live'))->not->toBe([])
        ->and($hits)->toBe([]);
});

it('keeps the consumer of notifications free of writes', function () {
    $file = 'app/Notifications/NotificationConsumer.php';
    $code = (string) file_get_contents(repo_path($file));

    expect([...modelWrites($code, $file), ...inserts($code, $file)])->toBe([]);
});

it('detects a handle() without an Actor first', function () {
    expect(takesActorFirst((new class
    {
        public function handle(Actor $actor, string $name): void {}
    })::class))->toBeTrue();

    foreach ([
        new class
        {
            public function handle(string $name, Actor $actor): void {}
        },
        new class
        {
            public function handle(?Actor $actor): void {}
        },
        new class
        {
            public function handle(): void {}
        },
    ] as $action) {
        expect(takesActorFirst($action::class))->toBeFalse();
    }
});

it('gives every action an Actor first', function () {
    $exempt = fn (string $file) => str_starts_with($file, 'app/Actions/Auth/') || str_starts_with($file, 'app/Actions/Setup/')
        || $file === 'app/Actions/Accounts/NextHandle.php';

    $offenders = collect(appFiles('app/Actions'))->reject($exempt)
        ->map(fn (string $file) => 'App\\'.str_replace('/', '\\', substr($file, strlen('app/'), -strlen('.php'))))
        ->reject(fn (string $class) => takesActorFirst($class))->values()->all();

    expect($offenders)->toBe([]);
});

it('detects events recorded outside a transaction', function () {
    expect(recordsOutsideTransaction("<?php\nEventRecorder::record(EventType::UserUpdated, \$actor, \$user, null);"))->toBeTrue()
        ->and(recordsOutsideTransaction("<?php\nDB::transaction(fn () => EventRecorder::record(EventType::UserUpdated, \$actor, \$user, null));"))->toBeFalse()
        ->and(recordsOutsideTransaction("<?php\n\$user->save();"))->toBeFalse();
});

it('runs every action that records events in a transaction', function () {
    $offenders = collect(appFiles('app/Actions'))
        ->filter(fn (string $file) => recordsOutsideTransaction((string) file_get_contents(repo_path($file))))
        ->values()->all();

    expect($offenders)->toBe([]);
});

// App\OpenApi describes actions and never runs them: from App\Actions it reads class constants (`GroupWorkItems::KEYS`)
// and calls `spec()` (the rules of a list), nothing else (K16)
$actionUses = function (string $code, string $file = 'code'): array {
    preg_match_all('/^use (App\\\\Actions\\\\[\\w\\\\]+?)(?: as (\\w+))?;$/m', $code, $imports, PREG_SET_ORDER);
    $names = array_map(fn (array $import) => $import[2] ?? substr((string) strrchr('\\'.$import[1], '\\'), 1), $imports);
    $names[] = '\\\\?App\\\\Actions\\\\[\\w\\\\]+';
    $hits = [];

    foreach (explode("\n", $code) as $index => $line) {
        if (str_starts_with(ltrim($line), 'use ')) {
            continue;
        }

        foreach ($names as $name) {
            if (preg_match('/(?<![\\w\\\\])'.$name.'::(?!spec\\s*\\(|[A-Z][A-Z0-9_]*\\b(?!\\s*\\()|class\\b)/', $line) === 1
                || preg_match('/(?:new\\s+|app\\(\\s*|resolve\\(\\s*)'.$name.'\\b/', $line) === 1) {
                $hits[] = $file.':'.($index + 1);
                break;
            }
        }
    }

    return $hits;
};

it('detects uses of actions beyond their constants and spec()', function () use ($actionUses) {
    $code = <<<'PHP'
        <?php
        use App\Actions\WorkItems\GroupWorkItems;
        use App\Actions\Users\ListUsers as Users;
        $keys = GroupWorkItems::KEYS;
        $spec = Users::spec();
        #[ListOf(Users::class)]
        GroupWorkItems::run($actor, []);
        app(GroupWorkItems::class)->handle($actor, []);
        Users::make()->handle($actor);
        \App\Actions\Users\ListUsers::run($actor);
        new GroupWorkItems();
        $x = \App\Actions\Users\ListUsers::FILTERS;
        PHP;

    expect($actionUses($code))->toBe(['code:7', 'code:8', 'code:9', 'code:10', 'code:11']);
});

it('keeps App\OpenApi to the constants and spec() of actions', function () use ($actionUses) {
    $hits = collect(appFiles('app/OpenApi'))
        ->flatMap(fn (string $f) => $actionUses((string) file_get_contents(repo_path($f)), $f))->all();

    expect($hits)->toBe([]);
});

it('binds route parameters in a provider, never in a route file', function () {
    $files = glob(repo_path('routes/*.php')) ?: [];
    expect(array_map('basename', $files))->toContain('api.php', 'web.php');

    $hits = collect($files)
        ->filter(fn (string $file) => preg_match('/Route::(bind|model|patterns?)\(|\$router->(bind|model|patterns?)\(/', (string) file_get_contents($file)) === 1)
        ->map(fn (string $file) => basename($file))->values()->all();

    expect($hits)->toBe([]);
});

it('has no MemberInput any more', function () {
    expect(class_exists('App\Support\MemberInput'))->toBeFalse()
        ->and(file_exists(repo_path('app/Support/ProjectLock.php')))->toBeTrue()
        ->and(file_exists(repo_path('app/Support/ProjectMembership.php')))->toBeTrue();
});

it('locks the row of a project for update only in ProjectLock and PageLock', function () {
    $found = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(repo_path('app'))) as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }

        if (preg_match('/Project::query\(\)\s*->\s*(?:\w+\([^)]*\)\s*->\s*)*lockForUpdate\(/', (string) file_get_contents($file->getPathname())) === 1) {
            $found[] = $file->getFilename();
        }
    }

    sort($found);
    expect($found)->toBe(['PageLock.php', 'ProjectLock.php']);
});
