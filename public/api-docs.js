// The "Try it" of /api/docs with the session of the web app: Sanctum wants the XSRF token on every request that
// changes something, as the app sends it (resources/js/api/http.ts). Only requests to this origin get it; a token
// (Authorization) needs nothing.
(() => {
    const originalFetch = window.fetch.bind(window);

    const xsrfToken = () => {
        const cookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('XSRF-TOKEN='));

        return cookie === undefined ? null : decodeURIComponent(cookie.slice('XSRF-TOKEN='.length));
    };

    window.fetch = (input, init = {}) => {
        const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
        const token = url.origin === window.location.origin ? xsrfToken() : null;

        if (token === null) {
            return originalFetch(input, init);
        }

        const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set('X-XSRF-TOKEN', token);

        return originalFetch(input, { ...init, headers });
    };
})();
