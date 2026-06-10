/**
 * Minimum sandbox tokens required on the sheet iframe.
 * `allow-same-origin` is essential — without it the sheet gets an opaque origin
 * and auth (cookies / localStorage) breaks entirely.
 */
export const SHEET_IFRAME_SANDBOX =
    'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals';
