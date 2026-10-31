<?php

namespace Database\Seeders;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Actions\Labels\DeleteLabel;
use App\Actions\Projects\PurgeProject;
use App\Actions\Properties\DeleteProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\Invitation;
use App\Models\Label;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\User;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Support\Actor;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * The demo data plus the accounts of the Playwright tests (e2e/), set back to their start state on every run, without
 * the open invitations, the projects and the catalog entries earlier runs left behind. The organization speaks English
 * here (the specs read the English texts); the demo data alone keep German. Never for production.
 */
class E2eSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'e2e-password';

    /** The secret of the two-factor accounts (Base32), the same for all of them. */
    public const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

    public const VARIANTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

    /** How the names of the projects and of the catalog entries the specs create begin; every run starts without them. */
    public const PROJECT_PREFIX = 'E2E ';

    /**
     * The eight recovery codes of the two-factor account of a Playwright project, derived from its name.
     *
     * @return list<string>
     */
    public static function recoveryCodes(string $variant): array
    {
        return array_map(function (int $number) use ($variant): string {
            $hash = hash('sha256', "{$variant}:{$number}");

            return substr($hash, 0, 10).'-'.substr($hash, 10, 10);
        }, range(1, 8));
    }

    public function run(): void
    {
        if (app()->isProduction()) {
            throw new RuntimeException('The e2e data must never be seeded in production.');
        }

        $this->call(DemoSeeder::class);

        Organization::current()->update(['locale' => Locale::En]);

        // the invitations of earlier runs: the lists of the specs stay short, and a run never meets an old link
        Invitation::query()->whereNull('accepted_at')->where('email', 'like', '%@example.com')->delete();

        // the projects earlier runs created (all named "E2E …"), with their identifiers: the suggestions of the dialog
        // start from the same free identifiers in every run
        Project::query()->where('name', 'like', self::PROJECT_PREFIX.'%')->each(function (Project $project): void {
            $project->forceFill(['deleting_at' => $project->deleting_at ?? Carbon::now()])->save();
            PurgeProject::run(Actor::automation('e2e_reset'), $project);
        });

        $this->removeCatalogEntries();

        $this->person('e2e@example.com', 'Erik Ende', OrgRole::Admin);

        foreach (self::VARIANTS as $variant) {
            $this->person("reset-{$variant}@example.com", 'Rita Reset');
            $this->person("security-{$variant}@example.com", 'Sam Security', extra: [
                'two_factor_secret' => null,
                'two_factor_recovery_codes' => null,
                'two_factor_confirmed_at' => null,
            ]);
            $this->person("twofactor-{$variant}@example.com", 'Tom Twofactor', extra: [
                'two_factor_secret' => encrypt(self::TOTP_SECRET),
                'two_factor_recovery_codes' => encrypt(json_encode(self::recoveryCodes($variant), JSON_THROW_ON_ERROR)),
                'two_factor_confirmed_at' => Carbon::now(),
            ]);
        }
    }

    /**
     * The catalog entries earlier runs created (named or labelled "E2E …"), through the delete actions so that the
     * rules apply as in the app. After the projects: their workflow and types are free by then. Types first, as they
     * hold properties; none of them is a default (the specs never change those).
     */
    private function removeCatalogEntries(): void
    {
        $actor = Actor::automation('e2e_reset');
        $like = self::PROJECT_PREFIX.'%';

        WorkItemType::query()->where('name', 'like', $like)->each(fn (WorkItemType $type) => DeleteWorkItemType::run($actor, $type));
        Property::query()->where('label', 'like', $like)->each(fn (Property $property) => DeleteProperty::run($actor, $property));
        Workflow::query()->where('name', 'like', $like)->each(fn (Workflow $workflow) => DeleteWorkflow::run($actor, $workflow));
        Label::query()->where('name', 'like', $like)->each(fn (Label $label) => DeleteLabel::run($actor, $label));
        RelationType::query()->where('name', 'like', $like)->each(fn (RelationType $type) => DeleteRelationType::run($actor, $type));
        Resolution::query()->where('label', 'like', $like)->each(fn (Resolution $resolution) => DeleteResolution::run($actor, $resolution));
    }

    /**
     * A person with this org role (set once, whatever it was before).
     *
     * @param  array<string, mixed>  $extra
     */
    private function person(string $email, string $name, OrgRole $role = OrgRole::Member, array $extra = []): User
    {
        $user = User::updateOrCreate(['email' => $email], [
            'type' => AccountType::Person,
            'name' => $name,
            'handle' => strstr($email, '@', true),
            'locale' => null,
            'password' => self::PASSWORD,
            ...$extra,
        ]);

        app(RoleAssignments::class)->setOrgRole($user, $role);

        return $user;
    }
}
