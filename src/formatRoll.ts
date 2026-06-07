import type { DiceRollPayload, NotifyVariant } from './types';

/** Toast text for a roll, e.g. "🎲 Alice: Longsword Attack — 18 💥". */
export function formatRollMessage(payload: DiceRollPayload): string {
    let crit = '';
    if (payload.isCrit) {
        if (payload.critKind === 'success') {
            crit = ' 💥';
        } else if (payload.critKind === 'failure') {
            crit = ' 💀';
        }
    }
    return `🎲 ${payload.characterName}: ${payload.title} — ${payload.total}${crit}`;
}

/** Maps a roll's crit state onto a toast variant. */
export function rollVariant(payload: DiceRollPayload): NotifyVariant {
    if (payload.isCrit && payload.critKind === 'success') {
        return 'success';
    }
    if (payload.isCrit && payload.critKind === 'failure') {
        return 'warning';
    }
    return 'info';
}
