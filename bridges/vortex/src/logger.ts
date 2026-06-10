import * as obrSdk from '@owlbear-rodeo/sdk';
import { whenObrReady } from '@longstoryshort/vtt-sdk/owlbear';
import {
    VORTEX_ORIGIN,
    ROOM_METADATA_KEY,
    PILL_HEIGHT,
    BRIDGE_CHANNEL,
    isVortexMessage,
    buildVortexUrl,
} from './shared';
import type { BridgeMessage } from './shared';
import { renderPreviewCard, renderSettings, renderContent } from './logger-render';
import { createPanelController } from './logger-panel';

type OBRInstance = typeof obrSdk.default;
declare global { interface Window { OBR: OBRInstance; } }

const MAX_HEIGHT = 600;

async function init() {
    window.OBR = obrSdk.default;
    await whenObrReady(window.OBR);
    console.log('[Vortex Logger] Initializing...');

    document.documentElement.style.setProperty('--pill-height', `${PILL_HEIGHT}px`);

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
    let lastContentH = MAX_HEIGHT - PILL_HEIGHT;

    function sendResize(height: number): void {
        const msg: BridgeMessage = { type: 'logger:resize', height };
        bridgeChannel.postMessage(msg);
    }

    function expandedHeight(): number {
        return Math.min(lastContentH + PILL_HEIGHT, MAX_HEIGHT);
    }

    // ── OBR data helpers ──────────────────────────────────────────────────────

    async function loadRoomId(): Promise<string | undefined> {
        const room = await window.OBR.room.getMetadata() as Record<string, unknown>;
        return room[ROOM_METADATA_KEY] as string | undefined;
    }

    // ── Panel controller ──────────────────────────────────────────────────────

    const panel = createPanelController(
        { content: contentEl, settings: settingsEl, previewCard: previewCardEl, badge },
        {
            sendResize,
            expandedHeight,
            onSettings: () => {
                loadRoomId()
                    .then((roomId) => renderSettings(settingsEl, roomId))
                    .catch(console.error);
            },
            onPreview: (summary) => {
                if (summary) renderPreviewCard(previewCardEl, summary);
            },
        },
    );

    // ── Vortex iframe ─────────────────────────────────────────────────────────

    async function syncContent(): Promise<void> {
        const roomId = await loadRoomId();
        const url = roomId ? buildVortexUrl(`/room/${roomId}/logger`) : null;
        renderContent(contentEl, url);
        if (panel.current() === 'settings') {
            renderSettings(settingsEl, roomId);
        }
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    settingsEl.addEventListener('click', async (e) => {
        if (!(e.target as HTMLElement).matches('.reset-btn')) return;
        try {
            await window.OBR.room.setMetadata({ [ROOM_METADATA_KEY]: undefined });
        } catch (err) {
            console.error('[Vortex Logger] Failed to reset room:', err);
        }
    });

    window.addEventListener('message', (event) => {
        if (event.origin !== VORTEX_ORIGIN) return;
        if (!isVortexMessage(event.data)) return;

        if (event.data.type === 'vortex:windowResize') {
            const h = event.data.height;
            if (h > 0) {
                lastContentH = h;
                const s = panel.current();
                if (s === 'logger' || s === 'settings') sendResize(expandedHeight());
            }
            return;
        }

        if (event.data.type === 'vortex:newRoll') {
            panel.onNewRoll(event.data.summary);
        }
    });

    pill.addEventListener('click', () => {
        panel.apply(panel.current() === 'logger' ? null : 'logger');
    });

    pillSettings.addEventListener('click', () => {
        panel.apply(panel.current() === 'settings' ? null : 'settings');
    });

    // ── Boot ──────────────────────────────────────────────────────────────────

    await syncContent().catch((err) => {
        console.error('[Vortex Logger] Error rendering content:', err);
    });

    window.OBR.room.onMetadataChange(() => {
        syncContent().catch((err) => {
            console.error('[Vortex Logger] Metadata change handler error:', err);
        });
    });
}

init().catch(console.error);
