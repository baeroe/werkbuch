<?php

use App\Access\Authorize;
use App\Access\RoleAssignments;
use App\Domain\Ulid;
use App\Events\EventRecorder;
use App\Exceptions\Problem;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Model;
use Lorisleiva\Actions\Concerns\AsAction;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

arch('php preset')->preset()->php();
arch('security preset')->preset()->security();
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
    expect(modelWrites("<?php\n\$user->save();\n\$this->set->handle(\$u);\nUser::create([]);"))->toBe(['code:2', 'code:4']);
});

it('never writes models in controllers, middleware, commands, jobs or auth adapters', function () {
    $hits = collect(['app/Http', 'app/Console', 'app/Jobs', 'app/Auth'])->flatMap(fn ($d) => appFiles($d))
        ->flatMap(fn (string $f) => modelWrites((string) file_get_contents(repo_path($f)), $f))->all();
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

// App\Webhooks reads (payloads, targets) and hands every write to an action (phase plan 11, Global Constraints); the
// folder comes with the payload and the consumer (tasks 4 to 6)
it('keeps App\Webhooks free of writes', function () {
    $hits = collect(appFiles('app/Webhooks'))
        ->flatMap(fn (string $f) => [...modelWrites((string) file_get_contents(repo_path($f)), $f), ...inserts((string) file_get_contents(repo_path($f)), $f)])
        ->all();

    expect($hits)->toBe([]);
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
