import type {
    NotifyVariant, SheetEvent, VTTAdapter, VTTUser,
} from '../../types';
import {
    BROADCAST_CHANNEL, DEFAULT_LABEL_TTL_MS, LABEL_METADATA_KEY,
} from './constants';
import { syncObrref } from './obrref';

// Type-only imports are erased at build time, so they stay SSR-safe; the actual
// runtime module is pulled in lazily via dynamic import inside `init()`.
type OwlbearSdk = typeof import('@owlbear-rodeo/sdk');
type Obr = OwlbearSdk['default'];

const DEV = process.env['NODE_ENV'] !== 'production';

const NOTIFY_VARIANT: Record<NotifyVariant, 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR'> = {
    info: 'INFO',
    success: 'SUCCESS',
    warning: 'WARNING',
    error: 'ERROR',
};

/**
 * Owlbear Rodeo implementation of {@link VTTAdapter}.
 *
 * Owlbear exposes no public dice API (its 3D roller is first-party and closed),
 * so rendering a roll is our job: we broadcast a result for toasts/logs and add
 * a transient label item over the roller's token — scene items are shared, so
 * everyone at the table sees the floating number. All scene work is best-effort
 * and degrades silently; the broadcast/notification path is the guaranteed core.
 */
export class OwlbearAdapter implements VTTAdapter {
    private sdk: OwlbearSdk | null = null;

    private obr: Obr | null = null;

    private user: VTTUser | undefined;

    private sessionId: string | undefined;

    private readyPromise: Promise<boolean> | null = null;

    private disposed = false;

    get isAvailable(): boolean {
        return this.obr?.isAvailable ?? false;
    }

    ready(): Promise<boolean> {
        if (!this.readyPromise) {
            this.readyPromise = this.init();
        }
        return this.readyPromise;
    }

    private async init(): Promise<boolean> {
        if (typeof window === 'undefined') {
            return false;
        }

        // The SDK reads `obrref` from the URL at import time; restore it first if
        // a client-side navigation (or a fresh chunk) dropped it.
        syncObrref();

        const sdk = await this.loadSdk();
        if (!sdk) {
            return false;
        }
        this.sdk = sdk;
        this.obr = sdk.default;
        if (DEV) {
            console.info(
                '[LSS/OBR] init — isAvailable:', this.obr.isAvailable,
                '| isReady:', this.obr.isReady,
            );
        }

        if (!this.obr.isAvailable) {
            if (DEV) {
                console.warn('[LSS/OBR] not embedded (origin empty) — obrref missing at SDK load.');
            }
            return false;
        }

        if (DEV) {
            console.info('[LSS/OBR] awaiting onReady (isReady =', this.obr.isReady, ')');
        }
        await new Promise<void>((resolve) => { this.obr!.onReady(resolve); });
        if (DEV) {
            console.info('[LSS/OBR] onReady fired — fetching player…');
        }
        if (this.disposed) {
            return false;
        }

        this.sessionId = this.obr.room.id;
        const [id, name, role] = await Promise.all([
            this.obr.player.getId(),
            this.obr.player.getName(),
            this.obr.player.getRole(),
        ]);
        this.user = { id, name, role: role === 'GM' ? 'gm' : 'player' };
        if (DEV) {
            console.info('[LSS/OBR] ready — room:', this.sessionId, 'user:', this.user);
        }

        return true;
    }

    private async loadSdk(): Promise<OwlbearSdk | null> {
        const host = window as unknown as { __lssObrSdk?: OwlbearSdk };
        // Prefer the copy preloaded at client entry — it attached its message
        // listener early enough to catch OBR's one-shot OBR_READY handshake.
        // Wait briefly in case the preload import is still in flight.
        for (let i = 0; i < 10 && !host.__lssObrSdk; i += 1) {
            await new Promise<void>((resolve) => { window.setTimeout(resolve, 50); });
        }
        if (host.__lssObrSdk) {
            return host.__lssObrSdk;
        }
        if (DEV) {
            console.warn('[LSS/OBR] no preloaded SDK — importing now (may miss OBR_READY)');
        }
        try {
            return await import('@owlbear-rodeo/sdk');
        } catch (error) {
            console.error('[LSS/OBR] SDK import failed:', error);
            return null;
        }
    }

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    getCurrentUser(): VTTUser | undefined {
        return this.user;
    }

    broadcast(event: SheetEvent): void {
        // Default destination is 'REMOTE' — delivered to every other client, the
        // sender excluded (the sender already handled the roll locally).
        void this.obr?.broadcast.sendMessage(BROADCAST_CHANNEL, event).catch(() => {});
    }

    onEvent(handler: (event: SheetEvent) => void): () => void {
        if (!this.obr) {
            return () => {};
        }
        return this.obr.broadcast.onMessage(BROADCAST_CHANNEL, (message) => {
            handler(message.data as SheetEvent);
        });
    }

    notify(message: string, variant: NotifyVariant = 'info'): void {
        void this.obr?.notification.show(message, NOTIFY_VARIANT[variant]).catch(() => {});
    }

    async labelOverSelection(text: string, ttlMs: number = DEFAULT_LABEL_TTL_MS): Promise<boolean> {
        const { obr, sdk } = this;
        if (!obr || !sdk) {
            return false;
        }

        try {
            const selection = await obr.player.getSelection();
            if (!selection || selection.length !== 1) {
                if (DEV) {
                    console.warn('[OwlbearAdapter] label skipped — selected tokens:', selection?.length ?? 0);
                }
                return false;
            }

            const [token] = await obr.scene.items.getItems(selection);
            if (!token) {
                if (DEV) {
                    console.warn('[OwlbearAdapter] label skipped — selected item not found in scene');
                }
                return false;
            }

            const label = sdk.buildLabel()
                .plainText(text)
                .position(token.position)
                .attachedTo(token.id)
                .pointerHeight(0)
                .disableHit(true)
                .locked(true)
                .layer('TEXT')
                .metadata({ [LABEL_METADATA_KEY]: true })
                .build();

            await obr.scene.items.addItems([label]);
            window.setTimeout(() => {
                void obr.scene.items.deleteItems([label.id]).catch(() => {});
            }, ttlMs);
            return true;
        } catch (error) {
            // Scene not loaded / no permission — labels are an enhancement, not
            // the contract. Log for diagnosis; the broadcast path keeps working.
            if (DEV) {
                console.warn('[OwlbearAdapter] label error:', error);
            }
            return false;
        }
    }

    dispose(): void {
        this.disposed = true;
    }
}
