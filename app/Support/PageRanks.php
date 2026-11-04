<?php

namespace App\Support;

use App\Domain\Ranking\Rank;
use App\Models\Page;
use App\Models\Project;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * The ranks of the pages of a wiki, per row of siblings (byte by byte, `ascii_bin`). Only under PageLock::tree, which
 * keeps the row of siblings as it is read. A rank never gets longer than ItemInput::RANK_MAX: when there is no room
 * between two neighbours, the row gets new ranks (A320).
 */
final class PageRanks
{
    /** The rank after the last sibling below `$parentId` (`null`: the top level), `a0` for the first. */
    public static function append(Project $project, ?string $parentId): string
    {
        // MAX over the `ascii_bin` column compares byte by byte
        $last = Page::query()->where('project_id', $project->id)->where('parent_id', $parentId)->max('rank');

        return Rank::between(is_string($last) ? $last : null, null);
    }

    /**
     * The rank of a page below `$parentId` (`null`: the top level) in front of the sibling `$beforeId` (`null`: at the
     * end). The siblings are the pages below the parent in their order (`rank` byte by byte, then the ULID) without the
     * page that moves (`$without`). When the rank between the neighbours would be longer than ItemInput::RANK_MAX, or
     * there is none (two siblings with one rank), the siblings get new short ranks in their order with a gap at the
     * place (A320): no event, the order stays, and over the query builder, so neither `updated_at` nor anything else
     * of a sibling changes (K13: VersionRule measures the pause of a page at `updated_at`).
     *
     * @throws ValidationException `field.before_id.sibling` at `before_id` when `$beforeId` is no sibling
     */
    public static function between(Project $project, ?string $parentId, ?string $beforeId, ?string $without): string
    {
        $siblings = array_values(Page::query()->where('project_id', $project->id)->where('parent_id', $parentId)
            ->when($without !== null, fn ($query) => $query->whereKeyNot($without))
            ->orderBy('rank')->orderBy('id')->toBase()->get(['id', 'rank'])
            ->map(fn (object $row) => ['id' => (string) $row->id, 'rank' => (string) $row->rank])->all());

        $index = $beforeId === null ? count($siblings) : array_search($beforeId, array_column($siblings, 'id'), true);
        if ($index === false) {
            throw ValidationException::withMessages(['before_id' => [__('field.before_id.sibling')]]);
        }

        try {
            $rank = Rank::between($siblings[$index - 1]['rank'] ?? null, $siblings[$index]['rank'] ?? null);
            if (strlen($rank) <= ItemInput::RANK_MAX) {
                return $rank;
            }
        } catch (InvalidArgumentException) {
            // two siblings share a rank: nothing fits between them
        }

        return self::spread($siblings, $index);
    }

    /**
     * New ranks for the row of siblings, one more than there are, and the one at `$index` for the page that moves.
     *
     * @param  list<array{id: string, rank: string}>  $siblings
     */
    private static function spread(array $siblings, int $index): string
    {
        $ranks = Rank::nBetween(null, null, count($siblings) + 1);
        foreach ($siblings as $position => $sibling) {
            $rank = $ranks[$position < $index ? $position : $position + 1];
            if ($rank !== $sibling['rank']) {
                Page::query()->whereKey($sibling['id'])->toBase()->update(['rank' => $rank]);
            }
        }

        return $ranks[$index];
    }
}
