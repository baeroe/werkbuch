<?php

namespace App\Http\Controllers\Api;

use App\Actions\Organization\GetOrganization;
use App\Actions\Organization\UpdateOrganization;
use App\Http\Api\Body;
use App\Http\Controllers\Controller;
use App\Http\Resources\OrganizationResource;
use App\OpenApi\AccountSchemas;
use App\Support\Actor;
use Illuminate\Http\Request;

final class OrganizationController extends Controller
{
    /**
     * The organization: name, language, time zone, first day of the week and logo.
     */
    public function show(Request $request): OrganizationResource
    {
        return new OrganizationResource(GetOrganization::run(Actor::fromRequest($request)));
    }

    /**
     * Change the organization (org admins).
     *
     * Only the keys that are named change. A new time zone makes every schedule of a template count anew from now.
     */
    #[Body(AccountSchemas::class, 'organization')]
    public function update(Request $request): OrganizationResource
    {
        return new OrganizationResource(UpdateOrganization::run(Actor::fromRequest($request), $request->all()));
    }
}
