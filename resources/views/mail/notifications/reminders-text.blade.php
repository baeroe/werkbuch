{{-- The plain text part of the reminders (App\Mail\NotificationDigest with `reminders`): no HTML, so nothing is escaped. --}}
{!! $subject !!}
{!! __('mail.notifications.reminders.intro') !!}

@foreach ($entries as $entry)
{!! $entry['key'] !!} {!! $entry['title'] !!}
{!! $entry['sentence'] !!}
{!! $entry['url'] !!}

@endforeach
{!! __('mail.notifications.reminders.open') !!}: {!! $myItemsUrl !!}

{!! __('mail.notifications.footer') !!}
{!! __('mail.notifications.settings') !!}: {!! $settingsUrl !!}
