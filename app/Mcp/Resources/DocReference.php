<?php

namespace App\Mcp\Resources;

use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\ResponseFactory;
use Laravel\Mcp\Server\Resource;
use RuntimeException;

/**
 * A reference section of the English docs as an MCP resource (A409): the text between `<!-- reference:start -->` and
 * `<!-- reference:end -->` of a page under `docs/en/`, read at run time, so the docs stay the one source. A page or a
 * mark that is missing is reported and answered as an error of the resource: `ReadResource` is not `Errable`, so the
 * client gets the JSON-RPC error -32603 with the text in `message` (K10); `reference_missing` is no problem reason.
 */
abstract class DocReference extends Resource
{
    public const START = '<!-- reference:start -->';

    public const END = '<!-- reference:end -->';

    protected string $mimeType = 'text/markdown';

    /** The page under `docs/en/`, e.g. `concepts/views.md`. */
    abstract protected function page(): string;

    public function handle(Request $request): Response|ResponseFactory
    {
        $path = rtrim((string) config('werkbuch.docs_path'), '/').'/en/'.$this->page();
        $file = is_file($path) ? file_get_contents($path) : false;
        $start = is_string($file) ? strpos($file, self::START) : false;
        $end = is_string($file) ? strpos($file, self::END) : false;

        if (! is_string($file) || $start === false || $end === false || $end < $start) {
            $message = $this->page().' lacks its reference marks';
            report(new RuntimeException($message));

            return Response::error('503 reference_missing: '.$message);
        }

        $from = $start + strlen(self::START);

        return Response::text(trim(substr($file, $from, $end - $from)));
    }
}
