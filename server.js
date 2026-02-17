const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const path = require('path');
const { Grid } = require('./grid');
const { UserManager } = require('./users');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    pingInterval: 10000,
    pingTimeout: 5000
});

const grid = new Grid();
const userManager = new UserManager();

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.socket.io"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            connectSrc: ["'self'", "ws:", "wss:"],
            imgSrc: ["'self'", "data:"]
        }
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 20;

class RateLimiter {
    constructor() {
        this.windows = new Map();
    }

    allow(socketId) {
        const now = Date.now();
        let timestamps = this.windows.get(socketId);
        if (!timestamps) {
            timestamps = [];
            this.windows.set(socketId, timestamps);
        }

        const cutoff = now - RATE_LIMIT_WINDOW_MS;
        timestamps = timestamps.filter(t => t >= cutoff);
        this.windows.set(socketId, timestamps);

        if (timestamps.length >= RATE_LIMIT_MAX) {
            return false;
        }

        timestamps.push(now);
        return true;
    }

    cleanup(socketId) {
        this.windows.delete(socketId);
    }
}

const rateLimiter = new RateLimiter();

const ipConnections = new Map();
const MAX_PER_IP = 5;

io.use((socket, next) => {
    const ip = socket.handshake.address;
    const count = ipConnections.get(ip) || 0;
    if (count >= MAX_PER_IP) {
        return next(new Error('Too many connections from this IP'));
    }
    ipConnections.set(ip, count + 1);
    socket.on('disconnect', () => {
        const c = ipConnections.get(ip) || 1;
        if (c <= 1) ipConnections.delete(ip);
        else ipConnections.set(ip, c - 1);
    });
    next();
});

io.on('connection', (socket) => {
    const user = userManager.addUser(socket.id);
    const config = grid.getConfig();

    console.log(`${user.name} connected (${userManager.getOnlineCount()} online)`);

    socket.emit('welcome', {
        user,
        gridState: grid.getState(),
        leaderboard: grid.getLeaderboard(),
        onlineCount: userManager.getOnlineCount(),
        config
    });

    socket.broadcast.emit('user-joined', {
        name: user.name,
        onlineCount: userManager.getOnlineCount()
    });

    socket.on('claim-cell', (data) => {
        if (!rateLimiter.allow(socket.id)) {
            socket.emit('claim-rejected', { reason: 'rate-limited' });
            return;
        }

        if (!data || typeof data !== 'object') {
            socket.emit('claim-rejected', { reason: 'Invalid payload' });
            return;
        }

        const { row, col } = data;

        const currentUser = userManager.getUser(socket.id);
        if (!currentUser) {
            socket.emit('claim-rejected', { reason: 'Unknown user' });
            return;
        }

        const result = grid.claimCell(row, col, currentUser);

        if (!result.success) {
            socket.emit('claim-rejected', {
                reason: result.reason,
                remainingMs: result.remainingMs || 0
            });
            return;
        }

        io.emit('cell-claimed', {
            row,
            col,
            owner: currentUser.name,
            color: currentUser.color,
            previousOwner: result.previousOwner
        });

        io.emit('leaderboard-update', grid.getLeaderboard());
    });

    socket.on('disconnect', () => {
        const removedUser = userManager.removeUser(socket.id);
        rateLimiter.cleanup(socket.id);

        if (removedUser) {
            console.log(`${removedUser.name} disconnected (${userManager.getOnlineCount()} online)`);

            socket.broadcast.emit('user-left', {
                name: removedUser.name,
                onlineCount: userManager.getOnlineCount()
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('Server running on port ' + PORT);
});

function gracefulShutdown(signal) {
    console.log(signal + ' received, shutting down...');
    io.emit('server-shutdown', { message: 'Server is restarting, please wait...' });
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    setTimeout(() => {
        console.warn('Forcing shutdown after timeout');
        process.exit(1);
    }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
