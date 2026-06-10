import type { SheetEvent } from '../../types';

export interface ObrPlayer {
    id: string;
    name: string;
    role: 'gm' | 'player';
}

/** Public contract of {@link OwlbearAdapter} — use this type when you need to reference the adapter without importing the class. */
export interface ObrAdapter {
    readonly isAvailable: boolean;
    ready(): Promise<boolean>;
    getSessionId(): string | undefined;
    getCurrentUser(): ObrPlayer | undefined;
    notify(message: string, variant?: 'info' | 'success' | 'warning' | 'error'): void;
    broadcast(event: SheetEvent): void;
    onEvent(handler: (event: SheetEvent) => void): () => void;
    getRoomMetadata(): Promise<Record<string, unknown>>;
    onRoomMetadataChange(handler: () => void): () => void;
    dispose(): void;
}
