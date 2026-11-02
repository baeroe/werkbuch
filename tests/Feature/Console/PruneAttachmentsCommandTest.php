<?php

use App\Access\ProjectRole;
use App\Models\Attachment;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('local');
    Carbon::setTestNow('2026-11-02 10:00:00');
});

/** Two pictures of an item that its text no longer names: 1.5 MB, 40 days old, and 1 KB, 5 days old. */
$unnamed = function (): array {
    $mara = User::factory()->create();
    $web = Project::factory()->identifier('WEB')->member($mara, ProjectRole::Admin)->create(['lead_id' => $mara->id]);
    $item = WorkItem::factory()->for($web)->create();
    $picture = fn (string $name, int $size, int $days) => Attachment::factory()->forItem($item)
        ->create(['uploaded_by' => $mara->id, 'filename' => $name, 'size' => $size, 'created_at' => now()->subDays($days)]);

    return [$picture('alt.png', 1_572_864, 40), $picture('neu.png', 1024, 5)];
};

it('lists what it prunes and sums it up', function () use ($unnamed) {
    [$old, $young] = $unnamed();

    $this->artisan('app:prune-attachments')
        ->expectsOutput("WEB  {$old->id}  alt.png  1.5 MB")
        ->doesntExpectOutputToContain('neu.png')
        ->expectsOutput('Pruned 1 attachment (1.5 MB).')
        ->assertSuccessful();

    expect(Attachment::query()->pluck('id')->all())->toBe([$young->id]);
});

it('only says what it would prune in a dry run, with the minimum age it is given', function () use ($unnamed) {
    $unnamed();

    $this->artisan('app:prune-attachments', ['--dry-run' => true, '--min-age' => '3'])
        ->expectsOutputToContain('alt.png')
        ->expectsOutputToContain('neu.png')
        ->expectsOutput('Would prune 2 attachments (1.5 MB).')
        ->assertSuccessful();

    expect(Attachment::query()->count())->toBe(2);
});

it('says so when there is nothing to prune', function () {
    $this->artisan('app:prune-attachments')
        ->expectsOutput('Pruned 0 attachments (0.0 MB).')
        ->doesntExpectOutputToContain('folder')
        ->assertSuccessful();
});

it('removes folders of files without a media row, and names them', function () {
    $disk = Storage::disk('local');
    $disk->put('900001/conversions/alt-preview.png', str_repeat('x', 2048));
    touch($disk->path('900001/conversions/alt-preview.png'), now()->subDays(40)->getTimestamp());

    $this->artisan('app:prune-attachments', ['--dry-run' => true])
        ->expectsOutput('orphaned files  900001  0.0 MB')
        ->expectsOutput('Would remove 1 folder of orphaned files (0.0 MB).')
        ->assertSuccessful();
    expect($disk->exists('900001/conversions/alt-preview.png'))->toBeTrue();

    $this->artisan('app:prune-attachments')
        ->expectsOutput('Removed 1 folder of orphaned files (0.0 MB).')
        ->assertSuccessful();
    expect($disk->exists('900001/conversions/alt-preview.png'))->toBeFalse();
});

it('refuses a minimum age that is not a whole number of days, at least one', function (string $age) use ($unnamed) {
    $unnamed();

    $this->artisan('app:prune-attachments', ['--min-age' => $age])
        ->expectsOutput('--min-age is a whole number of days, at least 1.')
        ->assertExitCode(1);

    expect(Attachment::query()->count())->toBe(2);
})->with(['0', '-3', '1.5', 'abc', '', '9999999']);
