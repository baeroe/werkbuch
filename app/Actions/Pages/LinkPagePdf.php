<?php

namespace App\Actions\Pages;

use App\Exceptions\Problem;
use App\Models\Page;
use App\Pdf\Gotenberg;
use App\Support\Actor;
use Illuminate\Support\Facades\URL;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * Where a wiki page is downloaded as PDF (WEBU-4; `GET /api/v1/pages/{page}/pdf`, MCP `pages:pdf`):
 * `{url, filename, pages}`. It checks what the download checks (the page, `subpages`, MAX_PAGES) and whether there
 * is a Gotenberg at all, and renders nothing: the PDF comes from `url` (`GET /pages/{page}/pdf`, the session of the web
 * app or the same token with `read`, like the file of an attachment, A235).
 */
final class LinkPagePdf
{
    use AsAction;

    /** The keys of the query. */
    public const KEYS = ['subpages'];

    /**
     * @param  array<string, mixed>  $input
     * @return array{url: string, filename: string, pages: int}
     *
     * @throws Problem 404, 503 `pdf_unavailable`
     * @throws ValidationException
     */
    public function handle(Actor $actor, Page|string $page, array $input): array
    {
        [$root, $ids] = ExportPagePdf::pages($actor, $page, $input);
        if (! app(Gotenberg::class)->configured()) {
            throw Problem::unavailable('pdf_unavailable');
        }
        $subpages = count($ids) > 1 || filter_var($input['subpages'] ?? false, FILTER_VALIDATE_BOOLEAN);

        return [
            'url' => URL::route('pages.pdf', ['page' => $root->id, ...($subpages ? ['subpages' => 1] : [])]),
            'filename' => ExportPagePdf::filename($root),
            'pages' => count($ids),
        ];
    }
}
