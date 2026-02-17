# GridLock

**Real-time multiplayer territory capture grid**

GridLock is a real-time shared canvas where players compete to claim territory on a 40×60 grid. Anyone who opens the page is instantly assigned a unique identity (random name + color) and can start clicking cells to claim them. Every claim is broadcast to all connected players via WebSockets — you see territory change hands in real time. Steal cells from other players, climb the leaderboard, and dominate the grid.

No signup. No login. Just open and play.

---

## Live Demo

**[Play GridLock Live →](https://gridlock-3et7.onrender.com/)**

> Open the link in **multiple browser tabs** to test multiplayer.
> Note: Free tier may take ~30 seconds to wake up on first visit.

---

## Features

- **40×60 grid** (2,400 cells) rendered on HTML5 Canvas for smooth performance
- **Real-time sync** via Socket.IO WebSockets — all clients see changes instantly
- **Random identity assignment** — each player gets an adjective-animal name and a unique HSL color
- **Territory stealing** — any user can reclaim any cell, no cells are locked
- **3-second per-user cooldown** between claims to prevent spam
- **Live leaderboard** showing top 10 players, updates in real time after every claim
- **Activity feed** tracking join, leave, claim, and steal events
- **Zoom** via scroll wheel (0.3× to 4×) and **Pan** via click-drag
- **Mobile support** — tap to claim, pinch to zoom, drag to pan with gesture detection
- **Claim animations** — expanding ripple effect on each captured cell
- **Hover tooltips** showing the owner of any claimed cell
- **Dark/Light theme toggle** with localStorage persistence
- **Connection status indicator** — disconnect/reconnect banner with auto-retry
- **Cooldown progress bar** — visual feedback during the 3-second wait
- **Glassmorphism UI** — frosted glass sidebar and topbar with blur effects
- **Per-IP connection limiting** — max 5 sockets per IP address
- **Server-side rate limiting** — sliding window algorithm, 20 events/sec per socket
- **Payload validation** on all incoming socket events (type checks, bounds checks)
- **Sparse state sync** — only claimed cells are sent to new connections, not all 2,400
- **Graceful shutdown** — server notifies clients before restarting on SIGTERM/SIGINT
- **Keyboard shortcut** — press Escape to reset zoom and center the view

---

## Tech Stack

| Layer | Technology | Why I Chose It |
|-------|-----------|----------------|
| Runtime | **Node.js** | Event-driven, non-blocking I/O — ideal for handling many concurrent WebSocket connections |
| HTTP Server | **Express.js** | Lightweight, serves static files, integrates seamlessly with Socket.IO middleware |
| Real-Time | **Socket.IO** | Built-in reconnection, fallback transports, room support — easier and more reliable than raw WebSockets |
| Rendering | **HTML5 Canvas** | Efficiently handles 2,400+ cells without the DOM overhead a CSS grid or div-per-cell approach would cause |
| State | **In-memory Map** | Zero-dependency, O(1) reads/writes, no database setup — sufficient for demo scope |
| Security | **Helmet.js** | Sets secure HTTP headers (CSP, XSS protection, etc.) with minimal configuration |
| Frontend | **Vanilla JS** | No build step, no framework bundle, full control over Canvas rendering pipeline |
| Identity | **Server-assigned names + HSL colors** | No signup friction, instant play, golden-angle hue spacing ensures visually distinct colors |

---

## Architecture

```
Browser (×N) ←——WebSocket——→ Node.js Server
                                ├── Express (static file serving)
                                ├── Socket.IO (real-time event routing)
                                ├── Grid State (in-memory Map, sparse)
                                ├── User Manager (identity assignment)
                                ├── Rate Limiter (sliding window per socket)
                                └── Helmet (security headers + CSP)
```

The server is the single source of truth. Clients send `claim-cell` requests, the server validates them (bounds check, cooldown check, rate limit check), updates the in-memory grid state, and broadcasts the result to all connected clients. There is no optimistic state — the client waits for server confirmation before the grid visually updates.

---

## Project Structure

```
inboxkit/
├── server.js        — Express + Socket.IO server, connection handling, event routing
├── grid.js          — Grid state manager, claim logic, cooldowns, leaderboard aggregation
├── users.js         — Random identity generator (adjective-animal names + HSL colors)
├── package.json     — Dependencies and npm scripts
└── public/
    ├── index.html   — Page structure, topbar, sidebar, canvas container
    ├── style.css    — Dark/light themes, glassmorphism, animations, responsive layout
    └── app.js       — Canvas renderer, zoom/pan controls, socket client, UI updates
```

---

## Real-Time Event Flow

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `connect` | Client → Server | — | Triggers identity assignment and welcome packet |
| `welcome` | Server → Client | `{ user, gridState, leaderboard, onlineCount, config }` | Full state sync on connection — sparse grid, identity, config |
| `claim-cell` | Client → Server | `{ row, col }` | Player attempts to claim a cell |
| `cell-claimed` | Server → All | `{ row, col, owner, color, previousOwner }` | Broadcast after a successful claim |
| `claim-rejected` | Server → Client | `{ reason, remainingMs }` | Sent when claim fails (cooldown, rate limit, invalid) |
| `leaderboard-update` | Server → All | `[{ name, color, count }, ...]` | Updated top-10 ranking after each claim |
| `user-joined` | Server → Others | `{ name, onlineCount }` | Broadcast when a new player connects |
| `user-left` | Server → Others | `{ name, onlineCount }` | Broadcast when a player disconnects |
| `server-shutdown` | Server → All | `{ message }` | Notifies clients before graceful shutdown |

---

## Design Decisions

### Why Canvas over DOM Grid?

A 40×60 grid means 2,400 cells. Rendering each as a DOM element (`<div>`) would cause severe layout and repaint performance issues — especially during zoom, pan, and rapid claim updates. Canvas gives full control over the rendering pipeline, makes viewport culling trivial (only draw cells that are currently visible), and keeps animations smooth at 60fps.

### Why Sparse Map over 2D Array?

At any given time, most cells are unclaimed. Storing and transmitting a full 2,400-element array would waste bandwidth on every new connection. The sparse `Map` (keyed by `"row:col"`) only stores claimed cells — typically a small fraction of the grid. This means the `welcome` payload stays small, and `Map.get()` gives O(1) lookups.

### Why In-Memory over Database?

For a demo, in-memory state is the simplest and fastest option — zero latency on reads/writes, no database setup, no connection pooling. The trade-off is that state is lost on server restart. A production version would use **Redis** for shared state if scaling horizontally across multiple server instances.

### Why Per-User Cooldown (not Per-Cell)?

A per-cell cooldown would make cells temporarily unlockable after being claimed, which removes the fun of territory wars. A per-user cooldown (3 seconds) limits spam and rate abuse while still allowing players to steal each other's cells freely. The 3-second interval is short enough to feel responsive but long enough to prevent flooding.

### Why Golden-Angle Hue Spacing for Colors?

Random RGB colors often look visually similar or clash. The golden angle (137.508°) is a mathematical constant that maximizes the angular distance between consecutive hues on the color wheel. Combined with fixed saturation (72%) and lightness (58%), this guarantees that every player gets a distinctly visible color — even with 50+ concurrent users.

### Conflict Resolution Strategy

Node.js is single-threaded, so socket events are processed sequentially — there are no race conditions when two players click the same cell simultaneously. The resolution is **last write wins**: the second claim overwrites the first, both players receive the broadcast, and the grid reflects the final state. The server-side cooldown is the only source of truth — the client-side cooldown bar is purely a UX convenience.

---

## Setup & Installation

### Prerequisites

- **Node.js** v16 or higher
- **npm** (comes with Node.js)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/your-username/gridlock.git
cd gridlock

# 2. Install dependencies
npm install

# 3. Start the server
node server.js

# 4. Open in browser
# Navigate to http://localhost:3000
# Open multiple tabs to test multiplayer
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

---

## Deployment

This app uses WebSockets, so the hosting platform must support persistent connections. Recommended options:

| Platform | Free Tier | WebSocket Support | Notes |
|----------|-----------|-------------------|-------|
| **Render** | Yes | Yes | Easiest setup, auto-deploy from GitHub |
| **Railway** | Trial | Yes | Fast cold starts, auto-detects Node.js |
| **Fly.io** | Yes | Yes | Better performance, requires CLI |
| **DigitalOcean** | $4/mo | Yes | Full VPS control, use with PM2 + Nginx |

For production, update the CORS origin in `server.js` from `'*'` to your actual domain.

---

## Bonus Features

Beyond the core grid mechanics, the following enhancements demonstrate additional engineering depth:

- **Theme toggle** with CSS custom properties design system and `localStorage` persistence
- **Viewport culling** — only visible cells are drawn, not all 2,400
- **Helmet.js CSP** — Content Security Policy headers beyond basic CORS
- **Graceful shutdown** — `SIGTERM`/`SIGINT` handlers broadcast to clients before exit
- **Per-IP connection limiting** — prevents a single user from opening excessive connections
- **Reconnection handling** — auto-reconnect with visual status banner and full state resync
- **Mobile gesture detection** — distinguishes taps from pans using distance threshold


