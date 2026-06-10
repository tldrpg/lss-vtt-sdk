import type { SheetEvent } from '../../types';
import type { NotifyVariant } from '../../formatRoll';
import type { ObrAdapter, ObrPlayer } from './types';
import { BROADCAST_CHANNEL } from './constants';
import { syncObrref } from './obrref';
import { loadObrSdk } from './loadObrSdk';
import { whenObrReady } from './whenObrReady';

// Type-only import is erased at build time — stays SSR-safe; runtime module
// is retrieved via loadObrSdk() which handles the preload/fallback contract.
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
 * Owlbear Rodeo bridge helper.
 *
 * Owlbear exposes no public dice API (its 3D roller is first-party and closed),
 * so rendering a roll is the bridge's job: broadcast a result for toasts/logs and
 * add a transient label item over the roller's token — scene items are shared, so
 * everyone at the table sees the floating number. All scene work is best-effort
 * and degrades silently; the broadcast/notification path is the guaranteed core.
 */
export class OwlbearAdapter implements ObrAdapter {
    private obr: Obr | null = null;

    private user: ObrPlayer | undefined;

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

        const sdk = await loadObrSdk();
        if (!sdk) {
            return false;
        }
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
        await whenObrReady(this.obr!);
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

    getSessionId(): string | undefined {
        return this.sessionId;
    }

    getCurrentUser(): ObrPlayer | undefined {
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

    getRoomMetadata(): Promise<Record<string, unknown>> {
        if (!this.obr) return Promise.resolve({});
        return this.obr.room.getMetadata().then(
            (meta) => meta as Record<string, unknown>,
            () => ({}),
        );
    }

    onRoomMetadataChange(handler: () => void): () => void {
        if (!this.obr) return () => {};
        return this.obr.room.onMetadataChange(handler);
    }

    dispose(): void {
        this.disposed = true;
    }
}
