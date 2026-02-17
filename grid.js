const ROWS = 40;
const COLS = 60;
const COOLDOWN_MS = 3000;

class Grid {
    constructor() {
        this.cells = new Map();
        this.cooldowns = new Map();
        this.scoreboard = new Map();
    }

    validatePayload(row, col) {
        if (typeof row !== 'number' || typeof col !== 'number') {
            return { valid: false, reason: 'Row and col must be numbers' };
        }
        if (!Number.isInteger(row) || !Number.isInteger(col)) {
            return { valid: false, reason: 'Row and col must be integers' };
        }
        if (row < 0 || row >= ROWS || col < 0 || col >= COLS) {
            return { valid: false, reason: 'Cell out of bounds' };
        }
        return { valid: true };
    }

    checkCooldown(userName) {
        const lastClaim = this.cooldowns.get(userName);
        if (!lastClaim) return { onCooldown: false, remainingMs: 0 };

        const elapsed = Date.now() - lastClaim;
        if (elapsed < COOLDOWN_MS) {
            return { onCooldown: true, remainingMs: COOLDOWN_MS - elapsed };
        }
        return { onCooldown: false, remainingMs: 0 };
    }

    claimCell(row, col, user) {
        const validation = this.validatePayload(row, col);
        if (!validation.valid) {
            return { success: false, reason: validation.reason };
        }

        const cd = this.checkCooldown(user.name);
        if (cd.onCooldown) {
            return {
                success: false,
                reason: 'cooldown',
                remainingMs: cd.remainingMs
            };
        }

        const key = `${row}:${col}`;
        const existing = this.cells.get(key);
        let previousOwner = null;

        if (existing && existing.owner === user.name) {
            return { success: false, reason: 'You already own this cell' };
        }

        if (existing) {
            previousOwner = existing.owner;
            const prevScore = this.scoreboard.get(previousOwner) || 0;
            if (prevScore <= 1) {
                this.scoreboard.delete(previousOwner);
            } else {
                this.scoreboard.set(previousOwner, prevScore - 1);
            }
        }

        this.cells.set(key, {
            owner: user.name,
            color: user.color,
            claimedAt: Date.now()
        });

        this.scoreboard.set(user.name, (this.scoreboard.get(user.name) || 0) + 1);
        this.cooldowns.set(user.name, Date.now());

        return { success: true, previousOwner };
    }

    getState() {
        const state = {};
        for (const [key, cell] of this.cells) {
            state[key] = { owner: cell.owner, color: cell.color };
        }
        return state;
    }

    getLeaderboard() {
        const entries = [];
        const colorMap = new Map();
        for (const cell of this.cells.values()) {
            if (!colorMap.has(cell.owner)) {
                colorMap.set(cell.owner, cell.color);
            }
        }
        for (const [name, count] of this.scoreboard) {
            entries.push({
                name,
                color: colorMap.get(name) || 'hsl(0, 0%, 50%)',
                count
            });
        }
        entries.sort((a, b) => b.count - a.count);
        return entries.slice(0, 10);
    }

    getConfig() {
        return { rows: ROWS, cols: COLS, cooldownMs: COOLDOWN_MS };
    }
}

module.exports = { Grid };
