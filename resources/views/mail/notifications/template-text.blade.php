{{-- The plain text part of the failed runs of a template (App\Mail\NotificationDigest with a template): no HTML, so nothing is escaped. --}}
{!! $subject !!}
{!! __('mail.notifications.template.intro') !!}

@foreach ($entries as $entry)
{!! $entry['error'] !!}
{!! $entry['at'] !!}

@endforeach
{!! __('mail.notifications.template.open') !!}: {!! $templateUrl !!}

{!! __('mail.notifications.footer') !!}
{!! __('mail.notifications.settings') !!}: {!! $settingsUrl !!}
