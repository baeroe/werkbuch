<!doctype html>
{{-- The API docs (GET /api/docs): Stoplight Elements from this origin only (CSP in ApiDocsController, K6); the document
     comes from /api/openapi.json. No inline script: the CSP allows none. --}}
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>{{ config('scramble.ui.title') }}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="{{ $stoplight }}/styles.min.css">
    <script src="{{ $stoplight }}/web-components.min.js"></script>
    <script src="/api-docs.js"></script>
    <style>
        html, body { margin: 0; height: 100%; }
        body { height: 100vh; overflow-y: hidden; background-color: var(--color-canvas); }
    </style>
</head>
<body>
<elements-api
    apiDescriptionUrl="/api/openapi.json"
    router="hash"
    layout="responsive"
    tryItCredentialsPolicy="include"
></elements-api>
</body>
</html>
