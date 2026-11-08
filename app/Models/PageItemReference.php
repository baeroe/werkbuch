<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;

/**
 * A page that names an item by a reference in its current text (A456). Written only by PageItemReferences::sync under
 * the lock of the page; it goes with its page and with its item (cascade). No event, no history.
 *
 * @property string $id
 * @property string $page_id
 * @property string $work_item_id
 */
final class PageItemReference extends Model
{
    use HasUlids;

    public $timestamps = false;
}
