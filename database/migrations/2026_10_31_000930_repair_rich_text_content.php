<?php

use App\RichText\ContentRepair;
use App\RichText\Document;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Since Phase 7 Document checks the content expressions of the editor (Schema::CONTENT), merges neighbouring texts
// with the same marks and orders marks like the editor. Documents stored before (descriptions and rich text values)
// may not fit: ContentRepair fills them, Document brings them into its form, and their plain text is written anew.
// Nothing else changes: no version, no `updated_at`, no event (the text reads the same).
return new class extends Migration
{
    public function up(): void
    {
        $this->repair('work_items', 'description', 'description_text');
        $this->repair('work_item_values', 'value_json', 'value_text');
    }

    public function down(): void
    {
        // the repaired documents stay: the form before is no longer readable
    }

    private function repair(string $table, string $json, string $text): void
    {
        DB::table($table)->whereNotNull($json)->select('id', $json, $text)->chunkById(500, function ($rows) use ($table, $json, $text) {
            foreach ($rows as $row) {
                $stored = json_decode((string) $row->{$json}, true);
                $document = Document::fromJson(ContentRepair::of((array) $stored));
                if ($document->toJson() !== $stored || $document->toText() !== $row->{$text}) {
                    DB::table($table)->where('id', $row->id)->update([$json => json_encode($document->toJson()), $text => $document->toText()]);
                }
            }
        });
    }
};
