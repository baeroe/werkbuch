<?php

namespace Tests\Support;

use App\Live\TerminatesUsers;
use Illuminate\Broadcasting\Broadcasters\Broadcaster;
use Illuminate\Support\Arr;
use Throwable;

/**
 * The broadcaster of the feature tests (`broadcasts()` in tests/Pest.php, driver `recording`): it keeps what would go
 * to Reverb. A message is `{channels, event, payload, socket}`, the socket pulled out of the payload as the Pusher
 * broadcaster does (the tab it leaves out); `terminated()` names the accounts whose connections Reverb would close
 * (K4). `failWith()` makes both throw, as a Reverb that is down.
 */
final class RecordingBroadcaster extends Broadcaster implements TerminatesUsers
{
    /** @var list<array{channels: list<string>, event: string, payload: array<string, mixed>, socket: string|null}> */
    private array $sent = [];

    /** @var list<string> */
    private array $terminated = [];

    private ?Throwable $failure = null;

    /**
     * @return list<array{channels: list<string>, event: string, payload: array<string, mixed>, socket: string|null}>
     */
    public function sent(): array
    {
        return $this->sent;
    }

    /**
     * @return list<string>
     */
    public function terminated(): array
    {
        return $this->terminated;
    }

    /** From now on every broadcast and every termination throws this (`null`: works again). */
    public function failWith(?Throwable $failure): void
    {
        $this->failure = $failure;
    }

    public function auth($request): mixed
    {
        return null;
    }

    public function validAuthenticationResponse($request, $result): mixed
    {
        return $result;
    }

    /**
     * @param  array<int, mixed>  $channels
     * @param  string  $event
     * @param  array<string, mixed>  $payload
     */
    public function broadcast(array $channels, $event, array $payload = []): void
    {
        if ($this->failure !== null) {
            throw $this->failure;
        }

        $socket = Arr::pull($payload, 'socket');
        /** @var list<string> $names */
        $names = $this->formatChannels($channels);
        $this->sent[] = ['channels' => $names, 'event' => $event, 'payload' => $payload, 'socket' => is_string($socket) ? $socket : null];
    }

    public function terminateUser(string $id): void
    {
        if ($this->failure !== null) {
            throw $this->failure;
        }

        $this->terminated[] = $id;
    }
}
