{{-- The test mail of the system page (App\Mail\TestMail): inline styles only, the colours of the light theme of
     DESIGN.md as hex, like the digest. --}}
<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{{ $heading }}</title>
</head>
<body style="margin:0;padding:0;background-color:#F5F7F9;color:#182336;font-family:Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F7F9;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #D7DDE4;border-radius:8px;">
<tr>
<td style="padding:20px 24px;">
<div style="color:#182336;font-size:18px;font-weight:700;line-height:1.3;">{{ $heading }}</div>
<p style="margin:8px 0 0;color:#182336;">{{ $body }}</p>
<p style="margin:16px 0 0;"><a href="{{ $appUrl }}" style="color:#2F51B6;">{{ $appUrl }}</a></p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>
