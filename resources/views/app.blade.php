<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <meta name="theme-color" content="#F5F7F9" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#181E28" media="(prefers-color-scheme: dark)" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script>
            // Theme before the first paint. 'light' and 'dark' set data-theme; 'system' (or nothing) leaves it to the OS.
            try {
                var theme = localStorage.getItem('werkbuch:theme');
                if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
            } catch (error) {
                // storage blocked: follow the OS
            }
        </script>
        @viteReactRefresh
        @vite(['resources/css/app.css', 'resources/js/app.tsx'])
        <title>werkbuch</title>
        @inertiaHead
    </head>
    <body>
        @inertia
    </body>
</html>
