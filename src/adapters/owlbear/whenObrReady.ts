interface ObrLike { onReady(cb: () => void): void; }

/** Promisifies `OBR.onReady` — resolves once the OBR_READY handshake completes. */
export function whenObrReady(obr: ObrLike): Promise<void> {
    return new Promise<void>((resolve) => { obr.onReady(resolve); });
}
