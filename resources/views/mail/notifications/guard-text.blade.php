{{-- The plain text part of an unauthorized merge (App\Mail\NotificationDigest with a guard, WEBU-24): no HTML, so nothing is escaped. --}}
{!! $subject !!}
{!! __('mail.notifications.guard.intro') !!}

@foreach ($entries as $entry)
{!! $entry['sentence'] !!}
{!! $entry['at'] !!}

@endforeach
{!! __('mail.notifications.guard.open') !!}: {!! $projectUrl !!}

{!! __('mail.notifications.footer') !!}
{!! __('mail.notifications.settings') !!}: {!! $settingsUrl !!}
