<?php

namespace App\Http\Controllers\Api;

use App\Actions\Users\GetMe;
use App\Http\Controllers\Controller;
use App\Http\Resources\MeResource;
use App\Support\Actor;
use Illuminate\Http\Request;

/**
 * The own account. Outside the routes of the session only (`/me/*`): a token of any ability with `read` may ask it.
 */
final class MeController extends Controller
{
    /**
     * The own account and the rights of its role in the organization.
     */
    public function show(Request $request): MeResource
    {
        return new MeResource(GetMe::run(Actor::fromRequest($request)));
    }
}
