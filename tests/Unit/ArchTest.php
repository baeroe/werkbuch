<?php

use App\Access\RoleAssignments;
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
arch('domain classes are final')->expect('App\Domain')->classes()->toBeFinal();
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
