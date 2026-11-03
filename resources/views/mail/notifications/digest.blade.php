{{-- The digest of a mail collection (App\Mail\NotificationDigest): inline styles only, the colours of the light theme
     of DESIGN.md (paper, ink, lines, ink blue) as hex, since mail clients know no oklch and no stylesheet. --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{ $key }} {{ $title }}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F7F9;color:#182336;font-family:Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F7F9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #D7DDE4;border-radius:8px;">
<tr>
<td style="padding:20px 24px;border-bottom:1px solid #D7DDE4;">
<a href="{{ $itemUrl }}" style="color:#2F51B6;font-size:13px;font-weight:600;text-decoration:none;">{{ $key }}</a>
<div style="margin-top:2px;color:#182336;font-size:18px;font-weight:700;line-height:1.3;">{{ $title }}</div>
</td>
</tr>
@foreach ($entries as $entry)
<tr>
<td style="padding:16px 24px;border-bottom:1px solid #D7DDE4;">
<div style="color:#182336;font-weight:600;">{{ $entry['sentence'] }}</div>
<div style="color:#596475;font-size:13px;">{{ $entry['at'] }}</div>
@if ($entry['html'] !== null)
<div style="margin-top:8px;padding:8px 12px;background-color:#EDF0F4;border-radius:6px;color:#182336;">{!! $entry['html'] !!}</div>
@elseif ($entry['cut'])
<div style="margin-top:8px;padding:8px 12px;background-color:#EDF0F4;border-radius:6px;color:#182336;">{!! nl2br(e($entry['text'])) !!}
<a href="{{ $itemUrl }}" style="color:#2F51B6;">{{ __('mail.notifications.read_more') }}</a></div>
@endif
</td>
</tr>
@endforeach
<tr>
<td style="padding:20px 24px;">
<a href="{{ $itemUrl }}" style="display:inline-block;padding:8px 16px;background-color:#2F51B6;border-radius:6px;color:#FFFFFF;font-weight:600;text-decoration:none;">{{ __('mail.notifications.open') }}</a>
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
