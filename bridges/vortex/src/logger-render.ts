import { SHEET_IFRAME_SANDBOX } from '@longstoryshort/vtt-sdk';
import type { RollSummary } from './shared';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Validates `value` as a CSS color via `CSS.supports`.
 * Returns the value unchanged when valid, `null` when not — preventing
 * untrusted strings from escaping into a CSS value context.
 */
function safeCssColor(value: string): string | null {
    return CSS.supports('color', value) ? value : null;
}

export function renderPreviewCard(el: HTMLElement, summary: RollSummary): void {
    const critClass = summary.isCritSuccess ? ' crit-success'
                    : summary.isCritFailure  ? ' crit-failure'
                    : '';
    const color = summary.color ? safeCssColor(summary.color) : null;
    const colorAttr = color ? ` style="--char-color:${color}"` : '';
    el.innerHTML = `
        <div class="preview-inner${critClass}"${colorAttr}>
            <span class="preview-author">${escapeHtml(summary.author)}</span>
            <div class="preview-body">
                <div class="preview-title-group">
                    <span class="preview-title">${escapeHtml(summary.title)}</span>
                    ${summary.subtitle ? `<span class="preview-subtitle">${escapeHtml(summary.subtitle)}</span>` : ''}
                </div>
                ${summary.total !== undefined ? `<span class="preview-total">${escapeHtml(summary.total)}</span>` : ''}
            </div>
        </div>
    `;
}

export function renderSettings(el: HTMLElement, roomId: string | undefined): void {
    el.innerHTML = `
        <div class="settings-section">
            <div class="settings-label">Привязанная комната Vortex</div>
            <div class="settings-value${roomId ? '' : ' empty'}">${roomId ?? 'не привязана'}</div>
        </div>
        ${roomId ? '<button class="reset-btn">Отвязать комнату</button>' : ''}
    `;
}

/** Replaces the iframe inside `el` only when the URL has changed. Clears `el` when `url` is null. */
export function renderContent(el: HTMLElement, url: string | null): void {
    const existing = el.querySelector('iframe') as HTMLIFrameElement | null;
    if ((existing?.src ?? null) === url) {
        return;
    }
    el.innerHTML = '';
    if (url) {
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.sandbox.add(...SHEET_IFRAME_SANDBOX.split(' '));
        iframe.allow = 'clipboard-write';
        el.appendChild(iframe);
    }
}
