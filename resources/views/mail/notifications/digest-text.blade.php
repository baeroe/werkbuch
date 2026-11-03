{{-- The plain text part of the digest (App\Mail\NotificationDigest): no HTML, so nothing is escaped. --}}
{!! $key !!} {!! $title !!}

@foreach ($entries as $entry)
{!! $entry['sentence'] !!} ({!! $entry['at'] !!})
@if ($entry['text'] !== null)
{!! $entry['text'] !!}
@endif

@endforeach
{!! __('mail.notifications.open') !!}: {!! $itemUrl !!}

{!! __('mail.notifications.footer') !!}
{!! __('mail.notifications.settings') !!}: {!! $settingsUrl !!}
