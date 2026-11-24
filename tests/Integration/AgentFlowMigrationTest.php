<?php

use App\Models\WorkItemLink;
use App\Models\WorkItemLinkCheck;
use Illuminate\Support\Facades\DB;

/*
 * The migration 2026_11_24_000400 (WEBU-26, A608): a link keeps workflow runs and commit statuses next to its check
 * runs (`kind`), under a unique index of link, kind and ID. Going back drops the rows of the new kinds first (their IDs
 * may meet those of check runs under the old index), then the index and the column (DatabaseMigrations, `--path`).
 */

const AGENT_FLOW_MIGRATION = 'database/migrations/2026_11_24_000400_create_agent_flow_tables.php';

it('drops the rows of workflow runs and statuses on the way back and keeps the check runs', function () {
    $link = WorkItemLink::factory()->create();
    $row = fn (string $kind) => WorkItemLinkCheck::query()->create(['work_item_link_id' => $link->id, 'kind' => $kind, 'check_run_id' => 7, 'name' => $kind,
        'status' => 'completed', 'conclusion' => 'success', 'head_sha' => str_repeat('a', 40)]);
    $check = $row('check');
    $row('workflow');
    $row('status');

    $this->artisan('migrate:rollback', ['--path' => AGENT_FLOW_MIGRATION])->assertSuccessful();
    expect(DB::table('work_item_link_checks')->pluck('id')->all())->toBe([$check->id]);

    $this->artisan('migrate')->assertSuccessful();
    expect(DB::table('work_item_link_checks')->value('kind'))->toBe('check');
});
