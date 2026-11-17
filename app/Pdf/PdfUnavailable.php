<?php

namespace App\Pdf;

use RuntimeException;

/** No PDF: Gotenberg is not configured, not reachable, failed or answered something that is no PDF (WEBU-4). */
final class PdfUnavailable extends RuntimeException {}
