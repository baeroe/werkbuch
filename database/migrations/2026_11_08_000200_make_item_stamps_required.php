<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Symfony\Component\Uid\Ulid;

// The stamps of items are required (Phase 15, Task 9, A440 replaces A406): `timestamps()` made both nullable, so the
// sort by them needed a mark of an empty value and `coalesce`, which no index serves in the keyset condition. Every
// item gets them from Eloquent; a row written without (none known, A427) gets the time of its ULID first, and a missing
// change is its creation. Neither column gets a default: with `explicit_defaults_for_timestamp` off, MariaDB would give
// the first of them `DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`, and every update without `updated_at`
// (the bookkeeping of ranks and templates) would move it. MariaDB 11.4 has it on; ItemStampsMigrationTest holds that
// neither column has one. The way back makes them nullable again and keeps the values.
return new class extends Migration
{
    public function up(): void
    {
        DB::table('work_items')
            ->where(fn ($query) => $query->whereNull('created_at')->orWhereNull('updated_at'))
            ->select(['id', 'created_at', 'updated_at'])
            ->chunkById(500, function ($items) {
                foreach ($items as $item) {
                    $born = Ulid::fromString(strtoupper($item->id))->getDateTime()->format('Y-m-d H:i:s');
                    $created = $item->created_at ?? $born;
                    DB::table('work_items')->where('id', $item->id)->update([
                        'created_at' => $created,
                        'updated_at' => $item->updated_at ?? $created,
                    ]);
                }
            });

        Schema::table('work_items', function (Blueprint $table) {
            $table->timestamp('created_at')->change();
            $table->timestamp('updated_at')->change();
        });
    }

    public function down(): void
    {
        Schema::table('work_items', function (Blueprint $table) {
            $table->timestamp('created_at')->nullable()->change();
            $table->timestamp('updated_at')->nullable()->change();
        });
    }
};
