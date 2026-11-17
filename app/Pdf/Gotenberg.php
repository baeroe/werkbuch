<?php

namespace App\Pdf;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Pool;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;

/**
 * Gotenberg 8, its Chromium route (WEBU-4, like openbill): `index.html` and the files it names (fonts) in one multipart
 * request, A4 with the margins of the print stylesheet, backgrounds printed. Gotenberg runs hardened in the stack (no
 * JavaScript, nothing but its own files and `data:` URLs, no private or public addresses): the HTML carries everything,
 * pictures as `data:` URLs. Laravel's HTTP client sends it (timeout, `Http::fake` in tests). Without a URL
 * (`GOTENBERG_URL` empty) there is no PDF; the browser and MCP say so (503 `pdf_unavailable`).
 */
final class Gotenberg
{
    public const ROUTE = '/forms/chromium/convert/html';

    public const HEALTH = '/health';

    /** Seconds to open the connection; the whole request has `$timeout`. */
    public const CONNECT_TIMEOUT = 5;

    public function __construct(private readonly ?string $url, private readonly int $timeout) {}

    public function configured(): bool
    {
        return $this->url !== null && $this->url !== '';
    }

    /**
     * The PDF of `$html`; `$files` are more files beside `index.html` (name → bytes), which the HTML names by name.
     *
     * @param  array<string, string>  $files
     *
     * @throws PdfUnavailable no URL, no connection, an error, or an answer that is no PDF
     */
    public function render(string $html, array $files = []): string
    {
        if (! $this->configured()) {
            throw new PdfUnavailable('Gotenberg is not configured (GOTENBERG_URL)');
        }

        $request = Http::connectTimeout(self::CONNECT_TIMEOUT)->timeout($this->timeout)->attach('files', $html, 'index.html');
        foreach ($files as $name => $bytes) {
            $request = $request->attach('files', $bytes, $name);
        }

        try {
            $response = $request->post(rtrim((string) $this->url, '/').self::ROUTE, [
                'paperWidth' => '8.27',
                'paperHeight' => '11.7',
                'preferCssPageSize' => 'true',
                'printBackground' => 'true',
            ]);
        } catch (ConnectionException $e) {
            throw new PdfUnavailable('Gotenberg not reachable: '.$e->getMessage(), previous: $e);
        }

        if (! $response->successful() || ! str_starts_with($response->body(), '%PDF-')) {
            throw new PdfUnavailable(sprintf('Gotenberg answered %d without a PDF', $response->status()));
        }

        return $response->body();
    }

    /** Asks for the health of Gotenberg in the pool of the system page, under `$key`; nothing without a URL. */
    public function statusRequest(Pool $pool, string $key): void
    {
        if ($this->configured()) {
            $pool->as($key)->connectTimeout(2)->timeout(2)->get(rtrim((string) $this->url, '/').self::HEALTH);
        }
    }

    /**
     * `off` without a URL, `ok` when Gotenberg answered its health in the pool, else `down`.
     *
     * @param  array<array-key, mixed>  $responses
     * @return 'ok'|'down'|'off'
     */
    public function statusFrom(array $responses, string $key): string
    {
        if (! $this->configured()) {
            return 'off';
        }

        return ($responses[$key] ?? null) instanceof Response && $responses[$key]->successful() ? 'ok' : 'down';
    }
}
