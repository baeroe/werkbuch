<?php

use App\Providers\ApiServiceProvider;
use App\Providers\AppServiceProvider;
use App\Providers\FortifyServiceProvider;
use App\Providers\RouteBindingServiceProvider;

return [
    AppServiceProvider::class,
    RouteBindingServiceProvider::class,
    ApiServiceProvider::class,
    FortifyServiceProvider::class,
];
