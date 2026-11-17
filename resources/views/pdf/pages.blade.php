{{--
    A wiki page, with its subpages, as one PDF (WEBU-4): rendered by Gotenberg's Chromium without JavaScript and
    without any address but its own files and data: URLs. The fonts lie beside index.html (App\Pdf\PagePrint::fonts),
    pictures are data: URLs in the text. The colours are those of the light theme (DESIGN.md, resources/css/tokens.css).
    $pages: list of {id, emoji, title, path (list of titles above it), changed (the line "Zuletzt geändert …"), html}.
--}}
<!DOCTYPE html>
<html lang="{{ $locale }}">
<head>
<meta charset="utf-8">
<title>{{ $title }}</title>
<style>
@font-face { font-family: 'Figtree'; src: url('figtree-latin.woff2') format('woff2'); font-weight: 300 900; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212; }
@font-face { font-family: 'Figtree'; src: url('figtree-latin-ext.woff2') format('woff2'); font-weight: 300 900; unicode-range: U+0100-02AF, U+1E00-1EFF, U+20A0-20CF, U+2C60-2C7F, U+A720-A7FF; }
@font-face { font-family: 'Bricolage Grotesque'; src: url('bricolage-latin.woff2') format('woff2'); font-weight: 200 800; unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+2122; }
@font-face { font-family: 'Bricolage Grotesque'; src: url('bricolage-latin-ext.woff2') format('woff2'); font-weight: 200 800; unicode-range: U+0100-02AF, U+1E00-1EFF, U+20A0-20CF; }
@page { size: A4; margin: 18mm 18mm 20mm; }
:root { --text: oklch(0.255 0.04 262); --muted: oklch(0.5 0.03 260); --faint: oklch(0.6 0.022 258); --border: oklch(0.895 0.012 255);
  --border-strong: oklch(0.8 0.016 255); --sunken: oklch(0.955 0.006 250); --accent: oklch(0.47 0.165 266); --marker: oklch(0.93 0.175 104); }
* { box-sizing: border-box; }
html { font-family: 'Figtree', system-ui, sans-serif; font-size: 10.5pt; line-height: 1.55; color: var(--text); }
body { margin: 0; }
h1, h2, h3, .toc-title { font-family: 'Bricolage Grotesque', 'Figtree', sans-serif; letter-spacing: -0.01em; line-height: 1.2; break-after: avoid; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
.sheet + .sheet, .toc + .sheet { break-before: page; }
.path { margin: 0 0 4mm; font-size: 8.5pt; color: var(--muted); }
.head { display: flex; align-items: center; gap: 3mm; margin: 0 0 2mm; }
.emoji { font-size: 22pt; line-height: 1; }
.head h1 { margin: 0; font-size: 22pt; font-weight: 700; }
.changed { margin: 0 0 6mm; padding-bottom: 3mm; border-bottom: 1px solid var(--border-strong); font-size: 8.5pt; color: var(--muted); }
.text h1 { font-size: 16pt; margin: 6mm 0 2mm; } .text h2 { font-size: 13pt; margin: 5mm 0 2mm; } .text h3 { font-size: 11.5pt; margin: 4mm 0 1.5mm; }
.text p { margin: 0 0 2.5mm; orphans: 3; widows: 3; }
.text ul, .text ol { margin: 0 0 2.5mm; padding-left: 6mm; }
.text li > p { margin: 0 0 1mm; }
.text ul[data-type="taskList"] { list-style: none; padding-left: 1mm; }
.text li[data-type="taskItem"] { display: flex; gap: 2mm; }
.text li[data-type="taskItem"]::before { content: '☐'; color: var(--muted); }
.text li[data-type="taskItem"][data-checked="true"]::before { content: '☑'; color: var(--accent); }
.text li[data-type="taskItem"] label { display: none; }
.text blockquote { margin: 0 0 3mm; padding: 1mm 0 1mm 4mm; border-left: 3px solid var(--border-strong); color: var(--muted); }
.text code { font-family: ui-monospace, 'DejaVu Sans Mono', monospace; font-size: 9pt; background: var(--sunken); border-radius: 3px; padding: 0.2mm 1mm; }
.text pre { margin: 0 0 3mm; padding: 3mm 4mm; background: var(--sunken); border: 1px solid var(--border); border-radius: 4px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
.text pre code { background: none; padding: 0; font-size: 8.5pt; line-height: 1.45; }
.text table { width: 100%; border-collapse: collapse; margin: 0 0 3mm; font-size: 9.5pt; break-inside: auto; }
.text th, .text td { border: 1px solid var(--border-strong); padding: 1.5mm 2.5mm; text-align: left; vertical-align: top; }
.text th { background: var(--sunken); font-weight: 600; }
.text tr { break-inside: avoid; }
.text td > p, .text th > p { margin: 0; }
.text hr { border: 0; border-top: 1px solid var(--border-strong); margin: 5mm 0; }
.text img { display: block; max-width: 100%; max-height: 200mm; height: auto; margin: 2mm 0 3mm; border-radius: 4px; break-inside: avoid; }
.text mark { background: var(--marker); }
.empty { color: var(--faint); font-style: italic; }
.toc-title { font-size: 18pt; font-weight: 700; margin: 0 0 1mm; }
.toc-lead { margin: 0 0 6mm; font-size: 9pt; color: var(--muted); }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { padding: 1.2mm 0; border-bottom: 1px dotted var(--border-strong); }
.toc a { color: var(--text); text-decoration: none; }
</style>
</head>
<body>
@if (count($pages) > 1)
<nav class="toc">
    <div class="toc-title">{{ __('pdf.toc') }}</div>
    <p class="toc-lead">{{ __('pdf.toc_lead', ['project' => $project, 'count' => count($pages), 'day' => $day]) }}</p>
    <ol>
        @foreach ($pages as $page)
        <li style="padding-left: {{ $page['depth'] * 6 }}mm"><a href="#page-{{ $page['id'] }}">{{ $page['emoji'] ? $page['emoji'].' ' : '' }}{{ $page['title'] }}</a></li>
        @endforeach
    </ol>
</nav>
@endif
@foreach ($pages as $page)
<article class="sheet" id="page-{{ $page['id'] }}">
    <p class="path">{{ implode(' / ', [$project, __('wiki.title'), ...$page['path']]) }}</p>
    <div class="head">
        @if ($page['emoji'])<span class="emoji">{{ $page['emoji'] }}</span>@endif
        <h1>{{ $page['title'] }}</h1>
    </div>
    <p class="changed">{{ $page['changed'] }}</p>
    @if ($page['html'] === '')
    <p class="empty">{{ __('pdf.empty') }}</p>
    @else
    <div class="text">{!! $page['html'] !!}</div>
    @endif
</article>
@endforeach
</body>
</html>
