<?php

namespace App\Http\Controllers;

use App\Exceptions\Problem;
use App\Support\RunnerDist;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * The installer and the binaries of the runner (spec 8.2, A520), without an account: neither is a secret, and a runner
 * has no token before it pairs. Never cached: the same address carries the binary of the next version.
 */
final class RunnerDownloadController extends Controller
{
    private const HEADERS = ['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff'];

    public function script(): Response
    {
        return response(RunnerDist::script(), 200, ['Content-Type' => 'text/plain; charset=utf-8', ...self::HEADERS]);
    }

    public function binary(string $os, string $arch): BinaryFileResponse
    {
        return response()->download($this->file($os, $arch), 'werkbuch-runner', ['Content-Type' => 'application/octet-stream', ...self::HEADERS]);
    }

    public function checksum(string $os, string $arch): Response
    {
        return response((string) file_get_contents($this->file($os, $arch).'.sha256'), 200, ['Content-Type' => 'text/plain; charset=utf-8', ...self::HEADERS]);
    }

    /** The binary of a target this instance built; anything else is 404. */
    private function file(string $os, string $arch): string
    {
        $path = RunnerDist::path($os, $arch);
        if ($path === null || ! is_file($path) || ! is_file($path.'.sha256')) {
            throw Problem::notFound();
        }

        return $path;
    }
}
