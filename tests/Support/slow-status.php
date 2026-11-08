<?php

// The router of the slow Meilisearch and Reverb in tests/Integration/SystemStatusTest.php (`php -S` with several
// workers): every request waits half a second, then answers as Meilisearch (`/health`, `/tasks`) and Reverb (`/up`) do.
usleep(500_000);
header('Content-Type: application/json');
echo json_encode(['total' => 0, 'status' => 'available', 'health' => 'OK']);

return true;
