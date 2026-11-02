<?php

use App\RichText\Document;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// The plain text of a rich text value (`Document::toText()`), so a filter can search it (`contains`) without reading
// the JSON of the document (its node names, its marks); ItemValues::store() writes it from now on, this fills it for
// the values that exist.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('work_item_values', function (Blueprint $table) {
            // a document holds up to 256 KiB, more than a `text` column
            $table->mediumText('value_text')->nullable()->after('value_json');
        });

        DB::table('work_item_values')->whereNotNull('value_json')->select('id', 'value_json')->chunkById(500, function ($rows) {
            foreach ($rows as $row) {
                $json = json_decode((string) $row->value_json, true);
                DB::table('work_item_values')->where('id', $row->id)->update(['value_text' => Document::fromJson((array) $json)->toText()]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('work_item_values', function (Blueprint $table) {
            $table->dropColumn('value_text');
        });
    }
};
