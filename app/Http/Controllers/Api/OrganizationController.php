<?php

namespace App\Http\Controllers\Api;

use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Http\Controllers\Controller;
use App\Http\Resources\OrganizationResource;
use App\Support\Actor;
use Illuminate\Http\Request;

final class OrganizationController extends Controller
{
    public function show(Request $request): OrganizationResource
    {
        return new OrganizationResource(GetOrganization::run(Actor::fromRequest($request)));
    }

    public function update(Request $request): OrganizationResource
    {
        return new OrganizationResource(UpdateOrganization::run(Actor::fromRequest($request), $request->all()));
    }
}
