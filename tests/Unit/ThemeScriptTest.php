<?php

// The theme is applied twice: by the inline script of the page before the first paint and by lib/theme.ts. Both must
// use the same storage key.
it('reads the theme from the same storage key in the page and in theme.ts', function () {
    expect(file_get_contents(repo_path('resources/views/app.blade.php')))->toContain("localStorage.getItem('werkbuch:theme')")
        ->and(file_get_contents(repo_path('resources/js/lib/theme.ts')))->toContain("THEME_KEY = 'werkbuch:theme'");
});
