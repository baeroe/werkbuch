{{-- The plain text part of a webhook the system switched off (App\Mail\NotificationDigest with a webhook): no HTML, so nothing is escaped. --}}
{!! $subject !!}
{!! __('mail.notifications.webhook.intro') !!}

@foreach ($entries as $entry)
{!! __('mail.notifications.webhook.sentence') !!}
{!! $entry['at'] !!}

@endforeach
{!! __('mail.notifications.webhook.open') !!}: {!! $deliveriesUrl !!}

{!! __('mail.notifications.footer') !!}
{!! __('mail.notifications.settings') !!}: {!! $settingsUrl !!}
