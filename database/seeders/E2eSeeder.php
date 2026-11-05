<?php

namespace Database\Seeders;

use App\Access\OrgRole;
use App\Access\RoleAssignments;
use App\Actions\Attachments\PruneUnownedAttachments;
use App\Actions\Labels\DeleteLabel;
use App\Actions\Projects\PurgeProject;
use App\Actions\Properties\DeleteProperty;
use App\Actions\RelationTypes\DeleteRelationType;
use App\Actions\Resolutions\DeleteResolution;
use App\Actions\Views\DeleteView;
use App\Actions\Workflows\DeleteWorkflow;
use App\Actions\WorkItemTypes\DeleteWorkItemType;
use App\Domain\Notifications\NotificationKind;
use App\Enums\AccountType;
use App\Enums\Locale;
use App\Models\Automation;
use App\Models\Invitation;
use App\Models\Label;
use App\Models\Notification;
use App\Models\NotificationMail;
use App\Models\NotificationPreference;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Property;
use App\Models\RelationType;
use App\Models\Resolution;
use App\Models\Template;
use App\Models\User;
use App\Models\View;
use App\Models\Workflow;
use App\Models\WorkItemType;
use App\Search\SearchIndexer;
use App\Support\Actor;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * The demo data plus the accounts of the Playwright tests (e2e/), set back to their start state on every run, without
 * the open invitations, the projects (with their items, comments and files), the uploads nobody owns, the views and
 * the catalog entries earlier runs left behind, and with the inbox accounts empty. The organization speaks English
 * here (the specs read the English texts); the demo data alone keep German. The automations of the demo projects are
 * off and their templates paused (K9). Never for production.
 */
class E2eSeeder extends Seeder
{
    use WithoutModelEvents;

    public const PASSWORD = 'e2e-password';

    /** The secret of the two-factor accounts (Base32), the same for all of them. */
    public const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

    public const VARIANTS = ['desktop-light', 'desktop-dark', 'phone-light', 'phone-dark'];

    /** How the names of the projects, views and catalog entries the specs create begin; every run starts without them. */
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

        // the DDEV scheduler runs templates and automations for real, on the database the specs share (K9): the demo
        // projects keep their automations off and their templates paused without a next term (the log stays), so no
        // night archives or cancels a demo item and no Monday adds one, also after something plans them anew (a zone
        // change, a restored project: RescheduleTemplates, W2); `updated_at` stays (the mark of a template's version)
        $demo = Project::query()->whereIn('identifier', ['WEB', 'APP', 'OPS'])->select('id');
        Automation::query()->whereIn('project_id', $demo)->toBase()->update(['enabled' => false]);
        Template::query()->whereIn('project_id', $demo)->toBase()->update(['next_run_at' => null]);
        Template::query()->whereIn('project_id', $demo)->whereNotNull('schedule')->toBase()->update(['schedule->paused' => true]);

        // the invitations of earlier runs: the lists of the specs stay short, and a run never meets an old link
        Invitation::query()->whereNull('accepted_at')->where('email', 'like', '%@example.com')->delete();

        // the projects earlier runs created (all named "E2E …"), with their identifiers: the suggestions of the dialog
        // start from the same free identifiers in every run
        Project::query()->where('name', 'like', self::PROJECT_PREFIX.'%')->each(function (Project $project): void {
            $project->forceFill(['deleting_at' => $project->deleting_at ?? Carbon::now()])->save();
            PurgeProject::run(Actor::automation('e2e_reset'), $project);
        });

        // the uploads of earlier runs nobody owns (a picture pasted into a text that was never saved), with their files;
        // those of the E2E projects went with them
        PruneUnownedAttachments::run(Actor::automation('e2e_reset'), Carbon::now());

        // the views earlier runs saved (all named "E2E …"), with the favorites that point to them
        View::query()->where('name', 'like', self::PROJECT_PREFIX.'%')->each(fn (View $view) => DeleteView::run(Actor::automation('e2e_reset'), $view));

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
            // the inbox and live specs (A289): every variant its own inbox, so that "mark all read" in one leaves the
            // others alone; it starts with the default preferences and one read notification without an item
            $this->freshInbox($this->person("inbox-{$variant}@example.com", "Inge Inbox {$variant}", extra: [
                'locale' => Locale::En,
                'timezone' => 'Europe/Berlin',
            ]));
        }

        // after the clean-up: the index of the demo data still held the projects and items of earlier runs
        app(SearchIndexer::class)->rebuild();
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
     * Takes the notifications of the account away, with its mail collections and its preferences, and leaves one read
     * notification without an item: a failed template of the public project WEB (as the demo inbox has one of OPS), which
     * the inbox spec deletes on the phone. Of the organisation (a switched-off webhook) only org admins hear.
     */
    private function freshInbox(User $user): void
    {
        Notification::query()->where('user_id', $user->id)->delete();
        NotificationMail::query()->where('user_id', $user->id)->delete();
        NotificationPreference::query()->where('user_id', $user->id)->delete();

        $at = Carbon::now()->subWeek();
        (new Notification)->forceFill([
            'user_id' => $user->id,
            'kind' => NotificationKind::TemplateRunFailed,
            'project_id' => Project::query()->where('identifier', 'WEB')->value('id'),
            'data' => ['error' => 'Required property Environment is missing'],
            'inbox' => true,
            'dedupe_key' => 'e2e:template',
            'read_at' => $at,
            'created_at' => $at,
            'updated_at' => $at,
        ])->save();
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
