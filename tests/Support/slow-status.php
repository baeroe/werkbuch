<?php

// The slow Meilisearch and Reverb of tests/Integration/SystemStatusTest.php: one process that holds every connection at
// once and answers each request half a second after it arrived, as Meilisearch (`/health`, `/tasks`) and Reverb (`/up`)
// do. It listens on a free port of 127.0.0.1 and writes that port on its first line.
//
// Not `php -S` with workers: a worker there takes several waiting connections and serves them one after the other, so
// the five requests of the pool ran one to four turns of half a second, and the fifth (Reverb) hit its 2 s timeout
// (final wave D). Here no request waits for another, and the test measures the pool of the client alone.

$server = stream_socket_server('tcp://127.0.0.1:0', $code, $message) ?: exit(1);
stream_set_blocking($server, false);
fwrite(STDOUT, substr((string) strrchr((string) stream_socket_get_name($server, false), ':'), 1)."\n");

$body = (string) json_encode(['total' => 0, 'status' => 'available', 'health' => 'OK']);
$answer = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ".strlen($body)."\r\nConnection: close\r\n\r\n".$body;

/** @var array<int, array{socket: resource, request: string, due: float|null}> $clients */
$clients = [];

while (true) {
    $read = [$server];
    $wait = 1.0;
    foreach ($clients as $client) {
        if ($client['due'] === null) {
            $read[] = $client['socket'];
        } else {
            $wait = min($wait, max(0.0, $client['due'] - microtime(true)));
        }
    }
    $write = $except = null;
    if (stream_select($read, $write, $except, 0, (int) ($wait * 1_000_000)) === false) {
        exit(1);
    }

    foreach ($read as $socket) {
        if ($socket === $server) {
            while (($client = @stream_socket_accept($server, 0)) !== false) {
                $clients[(int) $client] = ['socket' => $client, 'request' => '', 'due' => null];
            }

            continue;
        }

        $id = (int) $socket;
        $chunk = fread($socket, 8192);
        if ($chunk === false || ($chunk === '' && feof($socket))) {
            fclose($socket);
            unset($clients[$id]);

            continue;
        }
        $clients[$id]['request'] .= $chunk;
        if (str_contains($clients[$id]['request'], "\r\n\r\n")) {
            $clients[$id]['due'] = microtime(true) + 0.5;
        }
    }

    foreach ($clients as $id => $client) {
        if ($client['due'] !== null && $client['due'] <= microtime(true)) {
            fwrite($client['socket'], $answer);
            fclose($client['socket']);
            unset($clients[$id]);
        }
    }
}
