<?php

namespace App\Http\Controllers;

use App\Actions\Pages\ExportPagePdf;
use App\Models\Page;
use App\Support\Actor;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\HeaderUtils;

/**
 * A wiki page as PDF (WEBU-4), for the session of the web app and tokens with `read`, like the file of an attachment
 * (A235): `?subpages=1` takes the subtree along. Always a download, never sniffed, never cached by anyone else.
 */
final class PagePdfController extends Controller
{
    public function __invoke(Request $request, Page $page): Response
    {
        ['filename' => $name, 'pdf' => $pdf] = ExportPagePdf::run(Actor::fromRequest($request), $page, $request->only('subpages'));
        $ascii = trim((string) preg_replace('~[^\x20-\x7e]|[%/\\\\"]~', '_', Str::ascii($name)));

        return response($pdf, 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => HeaderUtils::makeDisposition('attachment', $name, $ascii === '' ? 'werkbuch.pdf' : $ascii),
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'private, no-store',
        ]);
    }
}
