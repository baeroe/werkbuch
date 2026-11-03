<?php

namespace App\Support;

use App\Access\Visibility;
use App\Models\User;
use App\Models\WorkItem;
use App\RichText\Document;
use App\RichText\RichTextNames;

/**
 * What one reader may see of the mentions and references of some texts (RichTextNames), for the Markdown of a resource:
 * the current handle and name of each mentioned account, with one query for all of them, and the key and title of each
 * referenced item the reader sees (Visibility), with one more; a reference to any other item is hidden. Texts without
 * such nodes ask nothing.
 */
final class ReaderNames
{
    /**
     * @param  iterable<array<string, mixed>>  $texts  stored Tiptap JSON
     */
    public static function of(iterable $texts, User $reader): RichTextNames
    {
        $people = $refs = [];
        foreach ($texts as $json) {
            $text = Document::fromJson($json);
            array_push($people, ...$text->mentionedUserIds());
            array_push($refs, ...$text->itemRefs());
        }
        $handles = $names = $seen = [];
        foreach (array_chunk(array_values(array_unique($people)), RichTextLookups::CHUNK) as $chunk) {
            foreach (User::query()->whereKey($chunk)->get(['id', 'handle', 'name']) as $user) {
                $handles[$user->id] = $user->handle;
                $names[$user->id] = $user->name;
            }
        }
        $refs = array_values(array_unique($refs));
        $visible = $refs === [] ? [] : Visibility::projectIds($reader)->all();
        foreach (array_chunk($refs, RichTextLookups::CHUNK) as $chunk) {
            $rows = WorkItem::query()->join('projects', 'projects.id', '=', 'work_items.project_id')
                ->whereIn('work_items.id', $chunk)->whereIn('work_items.project_id', $visible)
                ->toBase()->get(['work_items.id', 'work_items.title', 'work_items.number', 'projects.identifier']);
            foreach ($rows as $row) {
                $seen[(string) $row->id] = ['key' => "{$row->identifier}-{$row->number}", 'title' => (string) $row->title];
            }
        }

        return new RichTextNames($handles, $seen, $names);
    }
}
