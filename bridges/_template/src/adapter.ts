import type { NotifyVariant, SheetEvent, VTTAdapter, VTTUser } from '@longstoryshort/vtt-sdk';

/**
 * Stub VTTAdapter — replace every TODO with the matching call from your VTT's SDK.
 *
 * See docs/integration-guide.md for a full walkthrough of each method.
 */
export class MyVTTAdapter implements VTTAdapter {
    private ready_ = false;

    // ── Identity ──────────────────────────────────────────────────────────────

    get isAvailable(): boolean {
        // Return true only when the page runs inside your VTT (not a plain browser tab).
        // TODO: check a sentinel your VTT injects, e.g. `'MyVTT' in window`
        return false;
    }

    async ready(): Promise<boolean> {
        if (!this.isAvailable) return false;
        // TODO: await your VTT SDK's init / connect handshake
        // e.g. await MyVTT.initialize();
        this.ready_ = true;
        return true;
    }

    getSessionId(): string | undefined {
        if (!this.ready_) return undefined;
        // TODO: return the current room / session ID
        // e.g. return MyVTT.room.id;
        return undefined;
    }

    getCurrentUser(): VTTUser | undefined {
        if (!this.ready_) return undefined;
        // TODO: return { id, name, role } from your VTT's player API
        // e.g. const p = MyVTT.player.current();
        //      return p ? { id: p.id, name: p.displayName, role: p.isGM ? 'gm' : 'player' } : undefined;
        return undefined;
    }

    // ── Peer messaging ────────────────────────────────────────────────────────

    broadcast(event: SheetEvent): void {
        if (!this.ready_) return;
        // TODO: send `event` to every other player in the room via your VTT's channel.
        // e.g. MyVTT.room.broadcast(JSON.stringify(event));
    }

    onEvent(handler: (event: SheetEvent) => void): () => void {
        // TODO: subscribe to peer broadcasts; parse and forward to handler.
        // Return the unsubscribe function.
        // e.g. return MyVTT.room.onBroadcast((raw: string) => {
        //     try { handler(JSON.parse(raw) as SheetEvent); } catch { /* ignore */ }
        // });
        return () => { /* no-op until implemented */ };
    }

    // ── Table feedback ────────────────────────────────────────────────────────

    notify(message: string, variant?: NotifyVariant): void {
        if (!this.ready_) return;
        // TODO: show a toast via your VTT's notification API.
        // e.g. MyVTT.notification.show({ content: message, style: variant ?? 'info' });
        console.info(`[Bridge] ${variant ?? 'info'}: ${message}`);
    }

    async labelOverSelection(text: string, _ttlMs?: number): Promise<boolean> {
        if (!this.ready_) return false;
        // TODO: place a transient text label over the selected token on the VTT map.
        // Resolve false if no token is selected or the operation isn't supported —
        // createRollBridge falls back to notify() and continues without throwing.
        //
        // e.g. const selected = await MyVTT.scene.getSelection();
        //      if (selected.length !== 1) return false;
        //      await MyVTT.scene.addLabel(selected[0].id, { text, ttlMs: _ttlMs ?? 1500 });
        //      return true;
        return false;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    dispose(): void {
        this.ready_ = false;
        // TODO: tear down any subscriptions registered outside of onEvent().
        // (onEvent subscriptions are cleaned up by the fn each call returns.)
    }
}
