<?php

namespace Database\Seeders\Load;

use App\Domain\Ranking\Rank;
use App\Domain\Schedule\Schedule;
use App\Models\Attachment;
use App\Models\Organization;
use App\Models\Template;
use App\Models\Webhook;
use App\Models\WorkItem;
use App\Support\TemplateSchedule;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * What hangs on the items: 100 000 comments (5 000 per project, item number LoadItems::BUSY with 40 of them, every
 * other item with at most 39), 2 000 wiki pages in L01 (a tree four levels deep: 20, 180, 600, 1 200) with 0–5
 * versions each and a row in `page_item_references` for the item a text references, 200 templates (10 per project; the 50 of L01–L05 on the same weekly schedule, so they come due in the
 * same minute), 50 webhooks of the organization for `work_item.*`, all switched off (nothing is sent while seeding),
 * and the file list of the first epic of every project (FILES, rows of `attachments` and `media` without the files:
 * the list reads only the rows).
 * Bulk inserts in blocks of 1 000 without events, except the 250 templates and webhooks (their casts: schedule,
 * encrypted secret).
 *
 * @phpstan-import-type Frame from LoadCatalog
 * @phpstan-import-type Items from LoadItems
 */
final class LoadContent
{
    public const COMMENTS_PER_PROJECT = 5_000;

    public const BUSY_COMMENTS = 40;

    /** The pages of L01 on each level of the tree. */
    public const LEVELS = [20, 180, 600, 1_200];

    public const TEMPLATES_PER_PROJECT = 10;

    public const SCHEDULED = 50;

    public const WEBHOOKS = 50;

    /** The files of the first epic of every project: name, type, size, whether it has a preview. */
    public const FILES = [['entwurf.png', 'image/png', 48_213, true], ['konzept.pdf', 'application/pdf', 182_904, false], ['notizen.txt', 'text/plain', 2_310, false]];

    /**
     * @param  Frame  $frame
     * @param  list<Items>  $items  per project, in the order of the frame
     */
    public function __construct(private readonly array $frame, private readonly array $items, private readonly LoadTexts $texts) {}

    public function run(): void
    {
        foreach ($this->items as $items) {
            $this->comments($items);
        }

        $this->pages($this->frame['projects'][0]['id'], $this->items[0]);
        $this->templates();
        $this->webhooks();
        $this->files();
    }

    /** The file list of the first epic of every project, as UploadAttachment leaves it (kind `file`, one media row each). */
    private function files(): void
    {
        $attachments = [];
        $media = [];
        $type = (new Attachment)->getMorphClass();
        $owner = (new WorkItem)->getMorphClass();

        foreach ($this->items as $index => $items) {
            foreach (self::FILES as $order => [$name, $mime, $size, $preview]) {
                $id = strtolower((string) Str::ulid());
                $at = LoadItems::stamp($items['created'][0] + ($order + 1) * 3_600);
                $attachments[] = [
                    'id' => $id,
                    'project_id' => $this->frame['projects'][$index]['id'],
                    'attachable_type' => $owner,
                    'attachable_id' => $items['ids'][0],
                    'kind' => 'file',
                    'uploaded_by' => LoadRandom::pick($items['people']),
                    'filename' => $name,
                    'mime' => $mime,
                    'size' => $size,
                    'created_at' => $at,
                    'updated_at' => $at,
                ];
                $media[] = [
                    'model_type' => $type,
                    'model_id' => $id,
                    'uuid' => (string) Str::uuid(),
                    'collection_name' => 'file',
                    'name' => $id,
                    'file_name' => $id.'.'.pathinfo($name, PATHINFO_EXTENSION),
                    'mime_type' => $mime,
                    'disk' => 'local',
                    'conversions_disk' => 'local',
                    'size' => $size,
                    'manipulations' => '[]',
                    'custom_properties' => '[]',
                    'generated_conversions' => $preview ? '{"preview":true}' : '[]',
                    'responsive_images' => '[]',
                    'order_column' => 1,
                    'created_at' => $at,
                    'updated_at' => $at,
                ];
            }
        }

        self::insert('attachments', $attachments);
        self::insert('media', $media);
    }

    /**
     * @param  Items  $items
     */
    private function comments(array $items): void
    {
        $now = (int) strtotime(LoadItems::NOW.' UTC');
        $busy = LoadItems::BUSY - 1;
        $counts = array_fill(0, count($items['ids']), 0);
        $counts[$busy] = self::BUSY_COMMENTS;

        for ($left = self::COMMENTS_PER_PROJECT - self::BUSY_COMMENTS; $left > 0;) {
            $index = LoadRandom::int(0, count($items['ids']) - 1);
            if ($index !== $busy && $counts[$index] < self::BUSY_COMMENTS - 1) {
                $counts[$index]++;
                $left--;
            }
        }

        $rows = [];
        foreach ($counts as $index => $count) {
            for ($i = 0; $i < $count; $i++) {
                $entry = $this->texts->comments[LoadRandom::int(0, LoadTexts::POOL - 1)];
                $at = sprintf('%s.%06d', LoadItems::stamp(min($now, $items['created'][$index] + LoadRandom::int(3_600, 30 * 86_400))), LoadRandom::int(0, 999_999));
                $rows[] = [
                    'id' => strtolower((string) Str::ulid()),
                    'work_item_id' => $items['ids'][$index],
                    'author_id' => LoadRandom::pick($items['people']),
                    'body' => LoadTexts::pointedAt($entry, LoadRandom::pick($items['ids'])),
                    'body_text' => $entry['text'],
                    'edited_at' => null,
                    'created_at' => $at,
                    'updated_at' => $at,
                ];
            }
        }

        self::insert('comments', $rows);
    }

    /**
     * The tree of L01, level by level (a parent before its children); siblings ranked in their order, the pages on the
     * top level and about half of the others with an emoji.
     *
     * @param  Items  $items
     */
    private function pages(string $project, array $items): void
    {
        $now = (int) strtotime(LoadItems::NOW.' UTC');
        $parents = [null];
        $versions = [];
        $references = [];

        foreach (self::LEVELS as $level => $count) {
            // the pages of this level, spread over the parents of the level above as evenly as the counts allow
            $children = array_fill(0, count($parents), intdiv($count, count($parents)));
            for ($i = 0; $i < $count % count($parents); $i++) {
                $children[$i]++;
            }

            $rows = [];
            foreach ($parents as $p => $parent) {
                $ranks = Rank::nBetween(null, null, $children[$p]);
                foreach ($ranks as $rank) {
                    $entry = $this->texts->descriptions[LoadRandom::int(0, LoadTexts::POOL - 1)];
                    $created = $now - LoadRandom::int(30, 300) * 86_400;
                    $updated = min($now, $created + LoadRandom::int(0, 25) * 86_400);
                    $kept = LoadRandom::int(0, 5);
                    $id = strtolower((string) Str::ulid());

                    $rows[] = [
                        'id' => $id,
                        'project_id' => $project,
                        'parent_id' => $parent,
                        'rank' => $rank,
                        'title' => 'Seite '.LoadTexts::title(),
                        'emoji' => $level === 0 || LoadRandom::int(0, 1) === 0 ? '📄' : null,
                        'content' => LoadTexts::pointedAt($entry, $target = LoadRandom::pick($items['ids'])),
                        'content_text' => $entry['text'],
                        'version' => $kept + 1,
                        'created_by' => LoadRandom::pick($items['people']),
                        'updated_by' => LoadRandom::pick($items['people']),
                        'created_at' => LoadItems::stamp($created),
                        'updated_at' => LoadItems::stamp($updated),
                    ];

                    // the item the text references, as PageItemReferences records it (A456); a version counts for nothing
                    if (str_contains($entry['json'], LoadTexts::TARGET)) {
                        $references[] = ['id' => strtolower((string) Str::ulid()), 'page_id' => $id, 'work_item_id' => $target];
                    }

                    for ($v = 1; $v <= $kept; $v++) {
                        $older = $this->texts->descriptions[LoadRandom::int(0, LoadTexts::POOL - 1)];
                        $versions[] = [
                            'id' => strtolower((string) Str::ulid()),
                            'page_id' => $id,
                            'version' => $v,
                            'title' => 'Seite '.LoadTexts::title(),
                            'content' => LoadTexts::pointedAt($older, LoadRandom::pick($items['ids'])),
                            'author_id' => LoadRandom::pick($items['people']),
                            'created_at' => LoadItems::stamp($created + intdiv(($updated - $created) * $v, $kept + 1)),
                        ];
                    }
                }
            }

            self::insert('pages', $rows);
            $parents = array_column($rows, 'id');
        }

        self::insert('page_versions', $versions);
        self::insert('page_item_references', $references);
    }

    /**
     * Ten templates per project; those of the first five projects on one weekly schedule (Monday 09:00 on the calendar
     * of the organization), so the scheduler finds 50 due in the same minute.
     */
    private function templates(): void
    {
        $schedule = Schedule::parse(['frequency' => 'weekly', 'interval' => 1, 'weekdays' => [1], 'time' => '09:00', 'starts_on' => '2026-11-02', 'ends' => ['type' => 'never'], 'paused' => false]);
        $now = now()->toImmutable();
        $next = TemplateSchedule::nextRunAt($schedule, $now, 0, $now, new DateTimeZone(Organization::current()->timezone));

        $n = 0;
        foreach ($this->frame['projects'] as $index => $project) {
            for ($i = 1; $i <= self::TEMPLATES_PER_PROJECT; $i++, $n++) {
                $scheduled = $n < self::SCHEDULED;
                (new Template)->forceFill([
                    'project_id' => $project['id'],
                    'name' => sprintf('Vorlage %s-%02d', $project['identifier'], $i),
                    'payload' => [
                        'type_id' => $this->frame['types']['task'],
                        'title' => LoadTexts::title().' KW {week}',
                        'description' => null,
                        'priority' => 'medium',
                        'assignee_id' => LoadRandom::int(0, 1) === 1 ? LoadRandom::pick($this->items[$index]['people']) : null,
                        'label_ids' => [],
                        'values' => [],
                        'parent_id' => null,
                        'start_offset_days' => null,
                        'due_offset_days' => LoadRandom::int(0, 1) === 1 ? LoadRandom::int(1, 14) : null,
                    ],
                    'schedule' => $scheduled ? $schedule->toArray() : null,
                    'schedule_from' => $scheduled ? $now : null,
                    'next_run_at' => $scheduled ? $next : null,
                    'last_run_at' => null,
                    'run_count' => 0,
                    'created_by' => LoadRandom::pick($this->items[$index]['people']),
                ])->save();
            }
        }
    }

    private function webhooks(): void
    {
        for ($i = 1; $i <= self::WEBHOOKS; $i++) {
            (new Webhook)->forceFill([
                'name' => sprintf('Lastempfänger %02d', $i),
                'url' => 'https://receiver.example.com',
                'secret' => Webhook::newSecret(),
                'project_id' => null,
                'events' => ['work_item.*'],
                'bot_id' => null,
                'active' => false,
                'created_by' => $this->frame['admin'],
            ])->save();
        }
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private static function insert(string $table, array $rows): void
    {
        foreach (array_chunk($rows, LoadItems::BLOCK) as $block) {
            DB::table($table)->insert($block);
        }
    }
}
