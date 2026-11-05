<?php

namespace Tests\Support;

use RuntimeException;
use Symfony\Component\Process\Process;

/**
 * A real receiver of webhooks for tests/Integration: PHP's built-in server on 127.0.0.1 and a free port, routed by
 * tests/Support/webhook-receiver.php, which logs every request it gets. Stopped by stop() (afterEach).
 */
final class WebhookReceiver
{
    private function __construct(private readonly Process $process, public readonly int $port, private readonly string $log) {}

    public static function start(): self
    {
        $socket = stream_socket_server('tcp://127.0.0.1:0') ?: throw new RuntimeException('No free port.');
        $port = (int) substr((string) strrchr((string) stream_socket_get_name($socket, false), ':'), 1);
        fclose($socket);

        $log = (string) tempnam(sys_get_temp_dir(), 'receiver');
        $process = new Process([PHP_BINARY, '-S', "127.0.0.1:{$port}", __DIR__.'/webhook-receiver.php'], null, ['RECEIVER_LOG' => $log]);
        $process->start();

        $until = microtime(true) + 5;
        while (@fsockopen('127.0.0.1', $port) === false) {
            if (microtime(true) > $until || ! $process->isRunning()) {
                throw new RuntimeException('The receiver did not start: '.$process->getErrorOutput());
            }
            usleep(20_000);
        }

        return new self($process, $port, $log);
    }

    /**
     * The requests it got, in order.
     *
     * @return list<array{path: string, method: string, headers: array<string, string>, body: string}>
     */
    public function requests(): array
    {
        $lines = array_filter(explode(PHP_EOL, (string) file_get_contents($this->log)));

        return array_values(array_map(fn (string $line): array => json_decode($line, true), $lines));
    }

    public function stop(): void
    {
        $this->process->stop(0);
        @unlink($this->log);
    }
}
