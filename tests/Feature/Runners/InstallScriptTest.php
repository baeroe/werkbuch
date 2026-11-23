<?php

use App\Support\RunnerDist;
use Illuminate\Filesystem\Filesystem;
use Symfony\Component\Process\Process;

/*
 * resources/runner/install.sh as the instance serves it (spec 8.2, A520), run by sh with a fake curl and uname before
 * the PATH (and id, for root): the fake curl serves files of a folder, the "binary" it serves is a shell script that writes down how it
 * was called (version, login, service). Nothing reaches the network, launchd or systemd.
 */

beforeEach(function () {
    $this->root = sys_get_temp_dir().'/werkbuch-install-'.bin2hex(random_bytes(4));
    foreach (['fakes', 'serve/runner/download/linux', 'serve/runner/download/darwin', 'home', 'tmp'] as $dir) {
        mkdir("{$this->root}/{$dir}", 0o755, true);
    }
    file_put_contents("{$this->root}/fakes/curl", <<<'SH'
        #!/bin/sh
        echo "curl $*" >> "$FAKE_LOG"
        out=''
        while [ $# -gt 1 ]; do
            [ "$1" = -o ] && out=$2
            shift
        done
        file="$FAKE_SERVE/${1#*://*/}"
        [ -f "$file" ] || { echo "curl: (22) The requested URL returned error: 404" >&2; exit 22; }
        cp "$file" "$out"
        SH);
    file_put_contents("{$this->root}/fakes/uname", <<<'SH'
        #!/bin/sh
        case $1 in -s) echo "${FAKE_UNAME_S:-Linux}" ;; -m) echo "${FAKE_UNAME_M:-x86_64}" ;; esac
        SH);
    file_put_contents("{$this->root}/fakes/id", "#!/bin/sh\necho \"\${FAKE_UID:-1000}\"\n");
    chmod("{$this->root}/fakes/id", 0o755);
    chmod("{$this->root}/fakes/curl", 0o755);
    chmod("{$this->root}/fakes/uname", 0o755);
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->root);
});

/** The fake runner served for os/arch with its sum (or another sum). */
$serve = function (string $root, string $os = 'linux', string $arch = 'amd64', ?string $sum = null): string {
    $runner = <<<'SH'
        #!/bin/sh
        echo "runner $*" >> "$FAKE_LOG"
        case $1 in
            version) echo 0.3.2 ;;
            login)
                if [ -n "${FAKE_LOGIN_FAIL:-}" ]; then
                    echo "werkbuch-runner: the code was refused: The code has expired (valid for 10 minutes, once)." >&2
                    exit 1
                fi
                printf 'Paired as "box" with %s.\nPlaces: 2 in all.\nStart the daemon: werkbuch-runner daemon\n' "$2" ;;
            service)
                if [ "${3:-}" = --no-start ]; then echo "written to /units/werkbuch-runner.service, not started"; exit 0; fi
                if [ -n "${FAKE_SERVICE_FAIL:-}" ]; then echo "werkbuch-runner: systemctl --user daemon-reload: exit status 1" >&2; exit 1; fi
                echo "systemd werkbuch-runner.service enabled and started" ;;
        esac
        SH;
    $file = "{$root}/serve/runner/download/{$os}/{$arch}";
    file_put_contents($file, $runner);
    file_put_contents("{$file}.sha256", ($sum ?? hash('sha256', $runner))."  werkbuch-runner-{$os}-{$arch}\n");

    return $runner;
};

/** Runs the served installer with the arguments; returns [exit code, stdout, stderr, log lines]. */
$install = function (string $root, array $arguments, array $env = [], string $url = 'https://werkbuch.example.com') {
    config(['app.url' => $url]);
    file_put_contents("{$root}/install.sh", RunnerDist::script());
    $process = new Process(['sh', "{$root}/install.sh", ...$arguments], $root, [
        'PATH' => "{$root}/fakes:".getenv('PATH'), 'HOME' => "{$root}/home", 'TMPDIR' => "{$root}/tmp",
        'FAKE_LOG' => "{$root}/log", 'FAKE_SERVE' => "{$root}/serve", ...$env,
    ]);
    $process->run();
    $log = is_file("{$root}/log") ? explode("\n", trim((string) file_get_contents("{$root}/log"))) : [];

    return [$process->getExitCode(), $process->getOutput(), $process->getErrorOutput(), $log];
};

it('downloads the runner, checks its sum, installs, pairs and starts the service', function () use ($serve, $install) {
    $runner = $serve($this->root);
    $sum = hash('sha256', $runner);

    [$code, $out, $errors, $log] = $install($this->root, ['--code', 'K7QF-29XM', '--name', 'box']);

    expect($code)->toBe(0, $out.$errors)
        ->and($out)->toContain("werkbuch-runner installer\n\n  system       linux/amd64\n  instance     https://werkbuch.example.com\n")
        ->and($out)->toContain("✓ downloaded   werkbuch-runner linux/amd64 (0.0 MB)\n")
        ->and($out)->toContain('✓ checksum     sha256 '.substr($sum, 0, 4).'…'.substr($sum, 60, 4)." matches\n")
        ->and($out)->toContain("✓ installed    ~/.local/bin/werkbuch-runner (0.3.2)\n")
        ->and($out)->toContain("✓ paired       as box with https://werkbuch.example.com\n")
        ->and($out)->toContain("✓ service      systemd werkbuch-runner.service enabled and started\n")
        ->and($out)->toContain('The runner polls for runs now, for every project.')
        ->and($out)->toContain('~/.local/bin is not in your PATH')
        ->and(file_get_contents("{$this->root}/home/.local/bin/werkbuch-runner"))->toBe($runner)
        ->and(fileperms("{$this->root}/home/.local/bin/werkbuch-runner") & 0o777)->toBe(0o755)
        ->and(glob("{$this->root}/home/.local/bin/.*new*"))->toBe([])
        ->and(glob("{$this->root}/tmp/*"))->toBe([])
        ->and($log)->toHaveCount(5)
        ->and(array_slice($log, 2))->toBe(['runner version', 'runner login https://werkbuch.example.com --code K7QF-29XM --name box', 'runner service install'])
        ->and($log[0])->toStartWith('curl -fsSL --proto =https --retry 2 -o ')->toEndWith(' https://werkbuch.example.com/runner/download/linux/amd64')
        ->and($log[1])->toEndWith(' https://werkbuch.example.com/runner/download/linux/amd64.sha256');
});

it('installs again over a runner that is there, into a prefix, without a service', function () use ($serve, $install) {
    $runner = $serve($this->root, 'linux', 'arm64');
    mkdir("{$this->root}/p/bin", 0o755, true);
    file_put_contents("{$this->root}/p/bin/werkbuch-runner", 'old');

    [$code, $out, , $log] = $install($this->root, ['--code=K7QF-29XM', '--prefix', 'p', '--no-service'], [
        'FAKE_UNAME_M' => 'aarch64', 'PATH' => "{$this->root}/fakes:{$this->root}/p/bin:".getenv('PATH'),
    ]);

    expect($code)->toBe(0, $out)
        ->and(file_get_contents("{$this->root}/p/bin/werkbuch-runner"))->toBe($runner)
        ->and($log)->toContain('runner login https://werkbuch.example.com --code K7QF-29XM')
        ->and($log)->toContain('runner service install --no-start')
        ->and($out)->toContain("✓ installed    {$this->root}/p/bin/werkbuch-runner (0.3.2)\n")
        ->and($out)->toContain("✓ service      written to /units/werkbuch-runner.service, not started\n")
        ->and($out)->toContain('The runner is paired but does not run yet')
        ->and($out)->toContain('Open the TUI with werkbuch-runner.');
});

it('runs nothing it downloaded when the sum does not match', function () use ($serve, $install) {
    $serve($this->root, sum: str_repeat('0', 64));

    [$code, $out, $errors, $log] = $install($this->root, ['--code', 'K7QF-29XM']);

    expect($code)->toBe(1)
        ->and($errors)->toContain('✗ checksum     sha256 ')
        ->and($errors)->toContain('does not match '.str_repeat('0', 64).': nothing was installed')
        ->and($out)->not->toContain('✓ checksum')
        ->and(collect($log)->filter(fn (string $line) => str_starts_with($line, 'runner'))->all())->toBe([])
        ->and(file_exists("{$this->root}/home/.local/bin/werkbuch-runner"))->toBeFalse()
        ->and(glob("{$this->root}/tmp/*"))->toBe([]);
});

it('sets up no service when the code is refused', function () use ($serve, $install) {
    $serve($this->root);

    [$code, $out, $errors, $log] = $install($this->root, ['--code', 'K7QF-29XM'], ['FAKE_LOGIN_FAIL' => '1']);

    expect($code)->toBe(1)
        ->and($errors)->toContain('✗ paired       the code was refused: The code has expired (valid for 10 minutes, once).')
        ->and($out)->toContain('Create a new code in werkbuch: Settings → Runners → Connect runner, then run the command again.')
        ->and($out)->toContain('no service was set up')
        ->and($log)->not->toContain('runner service install');
});

it('says when the service does not start', function () use ($serve, $install) {
    $serve($this->root);

    [$code, $out, $errors] = $install($this->root, ['--code', 'K7QF-29XM'], ['FAKE_SERVICE_FAIL' => '1']);

    expect($code)->toBe(1)
        ->and($errors)->toContain('✗ service      systemctl --user daemon-reload: exit status 1')
        ->and($out)->toContain('The runner is paired but does not run. Start it yourself:');
});

it('reaches an instance over https only, http on this machine', function (string $url, bool $allowed, string $proto) use ($serve, $install) {
    $serve($this->root);

    [$code, , $errors, $log] = $install($this->root, ['--code', 'K7QF-29XM'], [], $url);

    if ($allowed) {
        expect($code)->toBe(0, $errors)->and($log[0])->toContain("--proto {$proto} ")->toEndWith("{$url}/runner/download/linux/amd64");
    } else {
        expect($code)->toBe(1)->and($errors)->toContain('✗ instance     ')->and($log)->toBe([]);
    }
})->with([
    'https' => ['https://werkbuch.example.com', true, '=https'],
    'localhost' => ['http://localhost:7740', true, '=http,https'],
    'loopback' => ['http://127.0.0.1:7740', true, '=http,https'],
    'ipv6 loopback' => ['http://[::1]:7740', true, '=http,https'],
    'http' => ['http://werkbuch.example.com', false, ''],
    'a name starting with 127' => ['http://127.0.0.1.example.com', false, ''],
    'no scheme' => ['werkbuch.example.com', false, ''],
]);

it('refuses what it cannot install', function (array $arguments, array $env, int $exit, string $says) use ($serve, $install) {
    $serve($this->root);

    [$code, $out, $errors] = $install($this->root, $arguments, $env);

    expect($code)->toBe($exit)->and($out.$errors)->toContain($says);
})->with([
    'no code' => [[], [], 1, '--code is missing: copy the command from werkbuch'],
    'an unknown option' => [['--code', 'X', '--sudo'], [], 2, 'unknown option --sudo'],
    'a code without its value' => [['--code'], [], 2, '--no-service'],
    'root' => [['--code', 'X'], ['FAKE_UID' => '0'], 1, 'do not run the installer as root or with sudo'],
    'windows' => [['--code', 'X'], ['FAKE_UNAME_S' => 'MINGW64_NT'], 1, 'the runner runs on macOS and Linux, not on MINGW64_NT'],
    'riscv' => [['--code', 'X'], ['FAKE_UNAME_M' => 'riscv64'], 1, 'the runner runs on arm64 and amd64, not on riscv64'],
    'no build for the system' => [['--code', 'X'], ['FAKE_UNAME_S' => 'Darwin', 'FAKE_UNAME_M' => 'arm64'], 1, 'could not download https://werkbuch.example.com/runner/download/darwin/arm64'],
    'help' => [['--help'], [], 0, 'Installs the werkbuch runner from this instance and pairs it.'],
]);
