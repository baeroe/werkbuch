<?php

namespace App\Http\Controllers;

use App\Providers\ApiServiceProvider;
use Illuminate\Http\Response;

/**
 * The page of the API docs (Stoplight Elements, checked in under public/vendor, K6): public, generates nothing itself
 * (the page loads `/api/openapi.json`) and runs no script of another origin.
 */
final class ApiDocsController extends Controller
{
    public function __invoke(): Response
    {
        return response()->view('api-docs', ['stoplight' => '/vendor/stoplight-elements/'.ApiServiceProvider::STOPLIGHT])
            ->withHeaders([
                'Content-Security-Policy' => ApiServiceProvider::DOCS_CSP,
                'X-Content-Type-Options' => 'nosniff',
                'Referrer-Policy' => 'same-origin',
            ]);
    }
}
