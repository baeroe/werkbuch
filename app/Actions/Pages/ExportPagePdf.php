<?php

namespace App\Actions\Pages;

use App\Access\Authorize;
use App\Exceptions\Problem;
use App\Models\Attachment;
use App\Models\Organization;
use App\Models\Page;
use App\Models\User;
use App\Pdf\Gotenberg;
use App\Pdf\PagePrint;
use App\Pdf\PdfUnavailable;
use App\RichText\Document;
use App\Support\Actor;
use App\Support\PageLock;
use Carbon\CarbonImmutable;
use finfo;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Lorisleiva\Actions\Concerns\AsAction;

/**
 * A wiki page as PDF (WEBU-4; the download `GET /pages/{page}/pdf`), with `subpages` its whole subtree in the order of
 * the tree and a table of contents in front. Whoever sees the page may (`view`, also a viewer); everyone else gets the
 * 404 of an unknown page. The text is the reader's (Document::toPrintHtml: current names, hidden references without
 * key or title); pictures of the project the reader may see are embedded as `data:` URLs, the preview where there is
 * one, each at most IMAGE_MAX_BYTES and all at most IMAGES_MAX_BYTES (the rest stays a line with its name). At most
 * MAX_PAGES pages (else 422 at `subpages`). Gotenberg renders it; without one, or when it fails, 503
 * `pdf_unavailable` (the cause reported). Nothing is written.
 */
final class ExportPagePdf
{
    use AsAction;

    public const MAX_PAGES = 100;

    public const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

    public const IMAGES_MAX_BYTES = 24 * 1024 * 1024;

    /**
     * @param  array<string, mixed>  $input
     * @return array{filename: string, pdf: string}
     *
     * @throws Problem 404, 503 `pdf_unavailable`
     * @throws ValidationException
     */
    public function handle(Actor $actor, Page|string $page, array $input): array
    {
        [$root, $ids] = self::pages($actor, $page, $input);
        $gotenberg = app(Gotenberg::class);
        if (! $gotenberg->configured()) {
            throw Problem::unavailable('pdf_unavailable');
        }

        $html = self::html($actor, $root, $ids);
        try {
            $pdf = $gotenberg->render($html, PagePrint::fonts());
        } catch (PdfUnavailable $e) {
            report($e);
            throw Problem::unavailable('pdf_unavailable');
        }

        return ['filename' => self::filename($root), 'pdf' => $pdf];
    }

    /**
     * The page (checked like reading it) and the IDs of the pages to print: the page alone, or with `subpages` its
     * subtree depth first in the order of the siblings.
     *
     * @param  array<string, mixed>  $input
     * @return array{0: Page, 1: list<string>}
     *
     * @throws Problem 404
     * @throws ValidationException
     */
    public static function pages(Actor $actor, Page|string $page, array $input): array
    {
        $page = GetPage::run($actor, $page);
        Validator::make($input, ['subpages' => ['nullable', 'boolean']], ['subpages.boolean' => __('field.boolean')])->validate();
        if (! filter_var($input['subpages'] ?? false, FILTER_VALIDATE_BOOLEAN)) {
            return [$page, [$page->id]];
        }

        $children = [];
        foreach (PageLock::pages($page->project) as $id => $parent) {
            $children[$parent ?? ''][] = $id;
        }
        $ids = [];
        $walk = function (string $id) use (&$walk, &$ids, $children): void {
            $ids[] = $id;
            foreach ($children[$id] ?? [] as $child) {
                $walk($child);
            }
        };
        $walk($page->id);

        if (count($ids) > self::MAX_PAGES) {
            throw ValidationException::withMessages(['subpages' => __('field.subpages.too_many', ['max' => self::MAX_PAGES, 'count' => count($ids)])]);
        }

        return [$page, $ids];
    }

    /** The file name: the title of the page, without what a file name cannot carry. */
    public static function filename(Page $page): string
    {
        $name = trim((string) preg_replace('~[\x00-\x1f\x7f/\\\\:*?"<>|]+~u', ' ', $page->title));

        return ($name === '' ? 'werkbuch' : $name).'.pdf';
    }

    /**
     * @param  list<string>  $ids
     */
    private static function html(Actor $actor, Page $root, array $ids): string
    {
        $reader = $actor->user;
        $project = $root->project;
        /** @var Collection<int, Page> $pages */
        $pages = Page::query()->whereIn('id', $ids)->get()->sortBy(fn (Page $page) => array_search($page->id, $ids, true))->values();
        Page::loadForResource($pages, $reader);

        $all = Page::query()->where('project_id', $project->id)->toBase()->get(['id', 'parent_id', 'title'])->keyBy('id');
        $editors = User::query()->whereIn('id', $pages->pluck('updated_by')->unique()->all())->pluck('name', 'id');
        $documents = $pages->mapWithKeys(fn (Page $page) => [$page->id => self::document($page)]);
        /** @var list<string> $attachmentIds */
        $attachmentIds = $documents->filter()->flatMap(fn (Document $doc) => $doc->attachmentIds())->unique()->values()->all();
        $images = self::images($actor, $project->id, $attachmentIds);
        $zone = Organization::current()->timezone;

        $entries = $pages->map(function (Page $page) use ($all, $editors, $documents, $images, $zone, $root) {
            // the titles above the page, from the top of the wiki
            $path = [];
            for ($parent = $all[$page->id]->parent_id ?? null; $parent !== null && isset($all[$parent]); $parent = $all[$parent]->parent_id) {
                array_unshift($path, (string) $all[$parent]->title);
            }
            $document = $documents[$page->id];

            return [
                'id' => $page->id,
                'emoji' => $page->emoji,
                'title' => $page->title,
                'path' => $path,
                'depth' => $page->id === $root->id ? 0 : self::depthBelow($all->map(fn (object $row) => $row->parent_id === null ? null : (string) $row->parent_id)->all(), $page->id, $root->id),
                // in the reader's language, which the request set (and with it Carbon's)
                'changed' => (string) __('wiki.page.changed', [
                    'name' => $editors[$page->updated_by] ?? __('items.someone'),
                    'day' => CarbonImmutable::instance($page->updated_at ?? now())->setTimezone($zone)->isoFormat('LL'),
                ]),
                'html' => $document === null || $document->isEmpty() ? '' : $document->toPrintHtml($page->rich_names ?? throw new \LogicException('names not loaded'), (string) config('app.url'), $images),
            ];
        })->values()->all();

        return PagePrint::html(array_values($entries), $root->title, $project->name, CarbonImmutable::now($zone)->isoFormat('LL'), app()->getLocale());
    }

    /**
     * How deep `$id` lies below `$root` (1 for a child).
     *
     * @param  array<array-key, ?string>  $parents  page id => parent id
     */
    private static function depthBelow(array $parents, string $id, string $root): int
    {
        $depth = 0;
        for ($at = $id; $at !== null && $at !== $root && array_key_exists($at, $parents); $at = $parents[$at]) {
            $depth++;
        }

        return $depth;
    }

    /** The stored text of a page (stored only after it read, ReaderNames has read it once already). */
    private static function document(Page $page): ?Document
    {
        return $page->content === null ? null : Document::fromJson($page->content);
    }

    /**
     * The pictures among `$ids` as `data:` URLs: attachments of the project the reader may see, each the preview where
     * there is one, else the original, at most IMAGE_MAX_BYTES each and IMAGES_MAX_BYTES together.
     *
     * @param  list<string>  $ids
     * @return array<string, string>
     */
    private static function images(Actor $actor, string $projectId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $urls = [];
        $total = 0;
        $attachments = Attachment::query()->with('media')->whereIn('id', $ids)->where('project_id', $projectId)->get()
            ->sortBy(fn (Attachment $attachment) => array_search($attachment->id, $ids, true));
        foreach ($attachments as $attachment) {
            $media = $attachment->getFirstMedia('file');
            if ($media === null || ! $attachment->isInlineImage() || ! Authorize::allows($actor, 'view', $attachment)) {
                continue;
            }
            // the preview where there is one (a picture stored before its conversion ran has none yet)
            $preview = $media->hasGeneratedConversion('preview') ? $media->getPath('preview') : null;
            $path = $preview !== null && is_file($preview) ? $preview : $media->getPath();
            $size = is_file($path) ? (int) filesize($path) : 0;
            if ($size === 0 || $size > self::IMAGE_MAX_BYTES || $total + $size > self::IMAGES_MAX_BYTES) {
                continue;
            }
            $total += $size;
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($path) ?: $attachment->mime;
            $urls[$attachment->id] = 'data:'.$mime.';base64,'.base64_encode((string) file_get_contents($path));
        }

        return $urls;
    }
}
