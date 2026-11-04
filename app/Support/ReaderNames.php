<?php

namespace App\Support;

use App\Access\Visibility;
use App\Models\Page;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\RichText\RichTextNames;

/**
 * What one reader may see of the mentions and references of some texts (RichTextNames), for the Markdown of a resource:
 * the current handle and name of each mentioned account, with one query for all of them, the key and title of each
 * referenced item the reader sees (Visibility), with one more, and the title and project identifier of each referenced
 * page the reader sees, with one more; a reference to any other item or page is hidden. Texts without such nodes ask
 * nothing (each query only when there is something to ask).
 */
final class ReaderNames
{
    /**
     * @param  iterable<array<string, mixed>>  $texts  stored Tiptap JSON
     */
    public static function of(iterable $texts, User $reader): RichTextNames
    {
        $people = $refs = $pageRefs = [];
        foreach ($texts as $json) {
            $text = Document::fromJson($json);
            array_push($people, ...$text->mentionedUserIds());
            array_push($refs, ...$text->itemRefs());
            array_push($pageRefs, ...$text->pageRefs());
        }
        $handles = $names = $seen = [];
        foreach (array_chunk(array_values(array_unique($people)), RichTextLookups::CHUNK) as $chunk) {
            foreach (User::query()->whereKey($chunk)->get(['id', 'handle', 'name']) as $user) {
                $handles[$user->id] = $user->handle;
                $names[$user->id] = $user->name;
            }
        }
        $refs = array_values(array_unique($refs));
        $pageRefs = array_values(array_unique($pageRefs));
        $visible = $refs === [] && $pageRefs === [] ? [] : Visibility::projectIds($reader)->all();
        foreach (array_chunk($refs, RichTextLookups::CHUNK) as $chunk) {
            $rows = WorkItem::query()->join('projects', 'projects.id', '=', 'work_items.project_id')
                ->whereIn('work_items.id', $chunk)->whereIn('work_items.project_id', $visible)
                ->toBase()->get(['work_items.id', 'work_items.title', 'work_items.number', 'projects.identifier']);
            foreach ($rows as $row) {
                $seen[(string) $row->id] = ['key' => "{$row->identifier}-{$row->number}", 'title' => (string) $row->title];
            }
        }

        $pages = [];
        foreach (array_chunk($pageRefs, RichTextLookups::CHUNK) as $chunk) {
            $rows = Page::query()->join('projects', 'projects.id', '=', 'pages.project_id')
                ->whereIn('pages.id', $chunk)->whereIn('pages.project_id', $visible)
                ->toBase()->get(['pages.id', 'pages.title', 'projects.identifier']);
            foreach ($rows as $row) {
                $pages[(string) $row->id] = ['title' => (string) $row->title, 'identifier' => (string) $row->identifier];
            }
        }

        return new RichTextNames($handles, $seen, $names, $pages);
    }
}
