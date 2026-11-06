{{-- A webhook the system switched off, for an org admin (App\Mail\NotificationDigest with a webhook, phase 11): one row per
     time, the same inline styles as the digest of an item. --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{ $subject }}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F7F9;color:#182336;font-family:Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F7F9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #D7DDE4;border-radius:8px;">
<tr>
<td style="padding:20px 24px;border-bottom:1px solid #D7DDE4;">
<div style="color:#182336;font-size:18px;font-weight:700;line-height:1.3;">{{ $subject }}</div>
<div style="margin-top:2px;color:#596475;font-size:13px;">{{ __('mail.notifications.webhook.intro') }}</div>
</td>
</tr>
@foreach ($entries as $entry)
<tr>
<td style="padding:16px 24px;border-bottom:1px solid #D7DDE4;">
<div style="color:#182336;font-weight:600;">{{ __('mail.notifications.webhook.sentence') }}</div>
<div style="color:#596475;font-size:13px;">{{ $entry['at'] }}</div>
</td>
</tr>
@endforeach
<tr>
<td style="padding:20px 24px;">
<a href="{{ $deliveriesUrl }}" style="display:inline-block;padding:8px 16px;background-color:#2F51B6;border-radius:6px;color:#FFFFFF;font-weight:600;text-decoration:none;">{{ __('mail.notifications.webhook.open') }}</a>
</td>
</tr>
</table>
<p style="max-width:600px;margin:16px auto 0;color:#596475;font-size:13px;">{{ __('mail.notifications.footer') }}
<a href="{{ $settingsUrl }}" style="color:#2F51B6;">{{ __('mail.notifications.settings') }}</a></p>
</td>
</tr>
</table>
</body>
</html>
