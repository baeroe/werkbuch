<?php

namespace App\Pdf;

/**
 * The HTML of printed wiki pages (WEBU-4, resources/views/pdf/pages.blade.php) and the fonts that go to Gotenberg
 * beside it: Figtree and Bricolage Grotesque from the build of the app (`public/build/assets`, the files Vite wrote for
 * the fontsource packages). Without a build (tests, a broken image) the PDF takes the fonts of Chromium.
 */
final class PagePrint
{
    /** Name beside index.html => pattern of the built file. */
    private const FONTS = [
        'figtree-latin.woff2' => 'figtree-latin-wght-normal-*.woff2',
        'figtree-latin-ext.woff2' => 'figtree-latin-ext-wght-normal-*.woff2',
        'bricolage-latin.woff2' => 'bricolage-grotesque-latin-opsz-normal-*.woff2',
        'bricolage-latin-ext.woff2' => 'bricolage-grotesque-latin-ext-opsz-normal-*.woff2',
    ];

    /**
     * @param  list<array{id: string, emoji: ?string, title: string, path: list<string>, depth: int, changed: string, html: string}>  $pages
     */
    public static function html(array $pages, string $title, string $project, string $day, string $locale): string
    {
        return view('pdf.pages', ['pages' => $pages, 'title' => $title, 'project' => $project, 'day' => $day, 'locale' => $locale])->render();
    }

    /**
     * The fonts of the build, by the name the HTML gives them; those not built are left out.
     *
     * @return array<string, string>
     */
    public static function fonts(): array
    {
        $fonts = [];
        foreach (self::FONTS as $name => $pattern) {
            $file = glob(public_path('build/assets/'.$pattern))[0] ?? null;
            if ($file !== null) {
                $fonts[$name] = (string) file_get_contents($file);
            }
        }

        return $fonts;
    }
}
