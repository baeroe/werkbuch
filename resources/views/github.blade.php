<!doctype html>
{{-- The plain page of the GitHub app (WEBU-24) until the settings show it (WEBU-27): the state of the app, its
     installations and repos, and for org admins without an app the form that posts the manifest to GitHub. No script. --}}
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('github.page.title') }}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <style>
        body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 48rem; padding: 2rem 1rem; color: #1d1b16; background: #fbf8f1; }
        h1 { font-size: 1.5rem; } h2 { font-size: 1.125rem; margin-top: 2rem; }
        table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: .375rem .5rem; border-bottom: 1px solid #ddd6c8; }
        .note { color: #5c574c; } .error { color: #a3261c; } code { font-size: .9em; }
        button, input { font: inherit; } button { padding: .375rem .875rem; }
    </style>
</head>
<body>
<main>
    <h1>{{ __('github.page.title') }}</h1>
    <p><a href="/settings/general">{{ __('github.page.back') }}</a></p>

    @if ($status['app'] === null)
        <p>{{ __('github.page.none') }}</p>
        @if ($start !== null)
            @if ($error !== null)<p class="error" role="alert">{{ $error }}</p>@endif
            <form method="get" action="{{ route('github') }}">
                <label for="organization">{{ __('github.page.organization') }}</label>
                <input id="organization" name="organization" value="{{ $organization }}" autocomplete="off">
                <button type="submit">{{ __('github.page.organization_apply') }}</button>
            </form>
            <form method="post" action="{{ $start['url'] }}">
                <input type="hidden" name="manifest" value="{{ json_encode($start['manifest'], JSON_UNESCAPED_SLASHES) }}">
                <p class="note">{{ __('github.page.connect_hint', ['name' => $start['manifest']['name']]) }}</p>
                <button type="submit">{{ __('github.page.connect') }}</button>
            </form>
        @elseif (! $manages)
            <p class="note">{{ __('problem.detail.github_admins_only') }}</p>
        @endif
    @else
        <dl>
            <dt>{{ __('github.page.app') }}</dt>
            <dd><a href="{{ $status['app']->html_url }}">{{ $status['app']->name }}</a> ({{ $status['app']->owner_login }})</dd>
        </dl>
        @if ($manages)
            <p><a href="{{ \App\GitHub\Manifest::installUrl($status['app']->slug) }}">{{ __('github.page.install') }}</a></p>
        @endif

        <h2>{{ __('github.page.installations') }}</h2>
        @forelse ($status['installations'] as $installation)
            <p>{{ $installation->account_login }} ({{ $installation->repository_selection }})@if ($installation->removed_at !== null) · {{ __('github.page.removed') }}@elseif ($installation->suspended_at !== null) · {{ __('github.page.suspended') }}@endif</p>
        @empty
            <p class="note">{{ __('github.page.no_installations') }}</p>
        @endforelse

        <h2>{{ __('github.page.repositories') }}</h2>
        @if ($status['repositories']->isEmpty())
            <p class="note">{{ __('github.page.no_repositories') }}</p>
        @else
            <table>
                <thead><tr><th scope="col">{{ __('github.page.repository') }}</th><th scope="col">{{ __('github.page.project') }}</th><th scope="col">{{ __('github.page.ruleset') }}</th></tr></thead>
                <tbody>
                @foreach ($status['repositories'] as $repository)
                    @php($link = $repository->link)
                    <tr>
                        <td><code>{{ $repository->full_name }}</code>@if ($repository->removed_at !== null) · {{ __('github.page.removed') }}@endif</td>
                        <td>@if ($link === null)–@elseif (in_array($link->project_id, $status['visible'], true)){{ $link->project->identifier }} · <code>{{ $link->base_branch }}</code>@if ($link->guarded()) · <strong>{{ __('github.page.guarded') }}</strong>@endif @else{{ __('github.page.taken') }}@endif</td>
                        <td>@if ($link === null || $link->protected === null)–@elseif ($link->protected){{ __('github.page.protected') }}@else{{ __('github.page.unprotected') }}@endif</td>
                    </tr>
                @endforeach
                </tbody>
            </table>
        @endif
    @endif
</main>
</body>
</html>
