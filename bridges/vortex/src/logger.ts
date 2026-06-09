import {
    VORTEX_ORIGIN,
    VORTEX_COLOR_SCHEME,
    ROOM_METADATA_KEY,
    IFRAME_SANDBOX,
    PILL_HEIGHT,
    BRIDGE_CHANNEL,
    isVortexMessage,
} from './shared';
import type { BridgeMessage, RollSummary } from './shared';

function buildVortexUrl(path: string): string {
    const url = new URL(path, VORTEX_ORIGIN);
    if (VORTEX_COLOR_SCHEME) url.searchParams.set('colorScheme', VORTEX_COLOR_SCHEME);
    return url.href;
}

declare global { interface Window { OBR: any; } }

const MAX_HEIGHT       = 600;
const PREVIEW_HEIGHT   = 160;
const PREVIEW_DURATION = 10_000;

type PanelState = 'logger' | 'settings' | 'preview' | null;

let panel: PanelState = null;
let unreadCount = 0;
let lastContentH = MAX_HEIGHT - PILL_HEIGHT;
let previewTimer: ReturnType<typeof setTimeout> | null = null;

async function init() {
    if (!window.OBR) {
        const parentOBR = (window.parent as any)?.OBR;
        if (parentOBR) {
            (window as any).OBR = parentOBR;
        } else {
            const { default: RealOBR } = await import('@owlbear-rodeo/sdk');
            (window as any).OBR = RealOBR;
        }
    }

    console.log('[Vortex Logger] Initializing...');
    await window.OBR.onReady();

    const contentEl     = document.getElementById('content')!;
    const settingsEl    = document.getElementById('settings')!;
    const previewCardEl = document.getElementById('preview-card')!;
    const pill          = document.getElementById('pill')!;
    const pillSettings  = document.getElementById('pill-settings')!;
    const badge         = document.getElementById('unread-badge')!;

    // ── OBR role check — settings visible to GM/owner only ───────────────────

    try {
        const role: string = await window.OBR.player?.getRole?.() ?? 'GM';
        if (role !== 'GM' && role !== 'OWNER') {
            pillSettings.style.display = 'none';
        }
    } catch { /* unknown OBR version — show settings by default */ }

    // ── Resize via BroadcastChannel (main frame calls OBR on our behalf) ─────

    const bridgeChannel = new BroadcastChannel(BRIDGE_CHANNEL);

    function sendResize(height: number) {
        const msg: BridgeMessage = { type: 'logger:resize', height };
        bridgeChannel.postMessage(msg);
    }

    function expandedHeight(): number {
        return Math.min(lastContentH + PILL_HEIGHT, MAX_HEIGHT);
    }

    // ── Badge ─────────────────────────────────────────────────────────────────

    function updateBadge() {
        if (unreadCount > 0) {
            badge.textContent = String(unreadCount);
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    // ── Panel state machine ───────────────────────────────────────────────────

    function applyPanel(next: PanelState, summary?: RollSummary) {
        if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }

        panel = next;
        contentEl.classList.toggle('expanded', next === 'logger');
        settingsEl.classList.toggle('expanded', next === 'settings');
        previewCardEl.style.display = next === 'preview' ? 'flex' : 'none';

        if (next === 'logger') { unreadCount = 0; updateBadge(); }
        if (next === 'settings') renderSettings().catch(console.error);
        if (next === 'preview' && summary) renderPreviewCard(summary);

        const height = next === 'preview'
            ? PREVIEW_HEIGHT
            : (next === 'logger' || next === 'settings')
                ? expandedHeight()
                : PILL_HEIGHT;
        sendResize(height);
    }

    // ── Preview card ──────────────────────────────────────────────────────────

    function escapeHtml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderPreviewCard(summary: RollSummary) {
        const critClass = summary.isCritSuccess ? ' crit-success'
                        : summary.isCritFailure  ? ' crit-failure'
                        : '';
        const colorAttr = summary.color ? ` style="--char-color:${escapeHtml(summary.color)}"` : '';
        previewCardEl.innerHTML = `
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

    // ── Settings panel ────────────────────────────────────────────────────────

    async function renderSettings() {
        const room = (await window.OBR.room.getMetadata()) as Record<string, unknown>;
        const roomId = room[ROOM_METADATA_KEY] as string | undefined;

        settingsEl.innerHTML = `
            <div class="settings-section">
                <div class="settings-label">Привязанная комната Vortex</div>
                <div class="settings-value${roomId ? '' : ' empty'}">${roomId ?? 'не привязана'}</div>
            </div>
            ${roomId ? '<button class="reset-btn">Отвязать комнату</button>' : ''}
        `;

        settingsEl.querySelector('.reset-btn')?.addEventListener('click', async () => {
            try {
                await window.OBR.room.setMetadata({ [ROOM_METADATA_KEY]: undefined });
            } catch (err) {
                console.error('[Vortex Logger] Failed to reset room:', err);
            }
        });
    }

    // ── Vortex iframe ─────────────────────────────────────────────────────────

    async function renderContent() {
        try {
            const room = (await window.OBR.room.getMetadata()) as Record<string, unknown>;
            const roomId = room[ROOM_METADATA_KEY] as string | undefined;
            const targetUrl = roomId ? buildVortexUrl(`/room/${roomId}/logger`) : null;

            const existing = contentEl.querySelector('iframe') as HTMLIFrameElement | null;
            if ((existing?.src ?? null) === targetUrl) return;

            contentEl.innerHTML = '';
            if (targetUrl) {
                const iframe = document.createElement('iframe');
                iframe.src = targetUrl;
                iframe.sandbox.add(...IFRAME_SANDBOX.split(' '));
                iframe.allow = 'clipboard-write';
                contentEl.appendChild(iframe);
            }

            if (panel === 'settings') renderSettings().catch(console.error);
        } catch (err) {
            console.error('[Vortex Logger] Error rendering content:', err);
        }
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    window.addEventListener('message', (event) => {
        if (event.origin !== VORTEX_ORIGIN) return;

        if (event.data?.type === 'vortex:loggerResize') {
            const h = event.data.height as number;
            if (typeof h === 'number' && h > 0) {
                lastContentH = h;
                if (panel === 'logger' || panel === 'settings') sendResize(expandedHeight());
            }
            return;
        }

        if (!isVortexMessage(event.data)) return;

        if (event.data.type === 'vortex:newRoll') {
            if (panel !== 'logger') { unreadCount++; updateBadge(); }
            if (panel === null || panel === 'preview') {
                applyPanel('preview', event.data.summary);
                previewTimer = setTimeout(() => { previewTimer = null; applyPanel(null); }, PREVIEW_DURATION);
            }
        }
    });

    // Each button is a simple toggle; clicking one always switches to it (or closes if active).
    pill.addEventListener('click', () => {
        applyPanel(panel === 'logger' ? null : 'logger');
    });

    pillSettings.addEventListener('click', () => {
        applyPanel(panel === 'settings' ? null : 'settings');
    });

    // ── Boot ──────────────────────────────────────────────────────────────────

    await new Promise((resolve) => setTimeout(resolve, 500));
    await renderContent();

    window.OBR.room.onMetadataChange(() => {
        renderContent().catch(console.error);
    });
}

init().catch(console.error);
