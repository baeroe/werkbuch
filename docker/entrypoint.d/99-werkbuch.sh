#!/bin/sh
# Stub until Task 3b: clears and builds the caches, so the image starts.
set -e
cd /var/www/html
php artisan config:clear --no-interaction
php artisan optimize --no-interaction
