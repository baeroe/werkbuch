<?php

namespace App\Http\Controllers;

use App\Actions\Media\ShowMedia;
use App\Support\Actor;
use Illuminate\Http\Request;
use Spatie\MediaLibrary\MediaCollections\Models\Media;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Pictures from the private disk (P15): only for signed-in accounts that may see them, never sniffed as anything else.
 */
final class MediaController extends Controller
{
    public function show(Request $request, Media $media): BinaryFileResponse
    {
        $media = ShowMedia::run(Actor::fromRequest($request), $media);

        // a file response is public unless told otherwise; these pictures are for signed-in accounts only
        return response()->file($media->getPath(), [
            'Content-Type' => $media->mime_type,
            'X-Content-Type-Options' => 'nosniff',
            // opened on its own, a picture runs nothing and loads nothing
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cache-Control' => 'private, max-age=86400',
        ])->setPrivate();
    }
}
