<?php

use Illuminate\Database\Eloquent\Model;
use Lorisleiva\Actions\Concerns\AsAction;

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
arch('models never call actions')->expect('App\Models')->not->toUse('App\Actions');

it('detects raw database writes', function () {
    $code = "<?php\nDB::table('users')->update([]);\nDB::table('users')->where('a', 1)->delete();\nDB::statement('x');\nDB::table('users')->get();";
    expect(rawWrites($code))->toBe(['code:2', 'code:3', 'code:4']);
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
