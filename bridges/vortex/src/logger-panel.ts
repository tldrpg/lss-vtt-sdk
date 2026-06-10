import { PILL_HEIGHT } from './shared';
import type { RollSummary } from './shared';

export type PanelState = 'logger' | 'settings' | 'preview' | null;

const PREVIEW_HEIGHT   = 160;
const PREVIEW_DURATION = 10_000;

export interface PanelElements {
    content:     HTMLElement;
    settings:    HTMLElement;
    previewCard: HTMLElement;
    badge:       HTMLElement;
}

export interface PanelCallbacks {
    /** Called by the controller whenever the popover height should change. */
    sendResize(height: number): void;
    /** Returns the current expanded height (content + pill). May change over time. */
    expandedHeight(): number;
    /** Called when the panel transitions to 'settings' — fetch data and re-render. */
    onSettings(): void;
    /** Called when the panel transitions to 'preview' — render the summary card. */
    onPreview(summary: RollSummary | undefined): void;
}

export interface PanelController {
    /** Transition to `next`, optionally carrying a roll summary for 'preview'. */
    apply(next: PanelState, summary?: RollSummary): void;
    /** Register an incoming roll: bumps the badge and shows a preview if idle. */
    onNewRoll(summary?: RollSummary): void;
    current(): PanelState;
}

/**
 * Encapsulates the logger's panel state machine.
 * All DOM mutations and side-effects are either local DOM class toggles
 * or delegated through `PanelCallbacks` — the controller has no knowledge
 * of OBR or rendering details.
 */
export function createPanelController(
    els: PanelElements,
    cbs: PanelCallbacks,
): PanelController {
    let state: PanelState = null;
    let unreadCount = 0;
    let previewTimer: ReturnType<typeof setTimeout> | null = null;

    function updateBadge(): void {
        if (unreadCount > 0) {
            els.badge.textContent = String(unreadCount);
            els.badge.style.display = 'inline-flex';
        } else {
            els.badge.style.display = 'none';
        }
    }

    function apply(next: PanelState, summary?: RollSummary): void {
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }

        state = next;
        els.content.classList.toggle('expanded', next === 'logger');
        els.settings.classList.toggle('expanded', next === 'settings');
        els.previewCard.style.display = next === 'preview' ? 'flex' : 'none';

        if (next === 'logger')   { unreadCount = 0; updateBadge(); }
        if (next === 'settings') { cbs.onSettings(); }
        if (next === 'preview')  {
            cbs.onPreview(summary);
            previewTimer = setTimeout(() => { previewTimer = null; apply(null); }, PREVIEW_DURATION);
        }

        const height = next === 'preview'            ? PREVIEW_HEIGHT
                     : (next === 'logger' || next === 'settings') ? cbs.expandedHeight()
                     : PILL_HEIGHT;
        cbs.sendResize(height);
    }

    function onNewRoll(summary?: RollSummary): void {
        if (state !== 'logger') { unreadCount++; updateBadge(); }
        if (state === null || state === 'preview') { apply('preview', summary); }
    }

    return { apply, onNewRoll, current: () => state };
}
