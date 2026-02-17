(function () {
    'use strict';

    let ROWS = 40;
    let COLS = 60;
    let COOLDOWN_MS = 3000;
    const CELL_SIZE = 20;
    const MIN_ZOOM = 0.3;
    const MAX_ZOOM = 4;
    const ZOOM_STEP = 0.15;

    let myUser = null;
    const cells = new Map();
    let leaderboard = [];
    let zoom = 1;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartPanX = 0;
    let panStartPanY = 0;
    let touchStartTime = 0;
    let touchStartPos = { x: 0, y: 0 };
    let touchMoved = false;
    let lastPinchDist = 0;
    let cooldownEndTime = 0;
    let cooldownRAF = 0;
    const claimAnimations = [];
    let animationRunning = false;
    let hoverCell = null;
    let renderPending = false;

    const canvas = document.getElementById('grid-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;
    const container = document.getElementById('canvas-container');
    const onlineCountEl = document.getElementById('online-count');
    const userNameEl = document.getElementById('user-name');
    const userColorDot = document.getElementById('user-color-dot');
    const leaderboardEl = document.getElementById('leaderboard');
    const yourCellsEl = document.getElementById('your-cells');
    const yourRankEl = document.getElementById('your-rank');
    const activityFeed = document.getElementById('activity-feed');
    const toastEl = document.getElementById('toast');
    const toastTextEl = document.getElementById('toast-text');
    const cooldownOverlay = document.getElementById('cooldown-overlay');
    const cooldownBar = document.getElementById('cooldown-bar');
    const zoomLevelEl = document.getElementById('zoom-level');
    const tooltipEl = document.getElementById('cell-tooltip');
    const tooltipTextEl = document.getElementById('tooltip-text');
    const connectionBanner = document.getElementById('connection-banner');
    const connectionText = document.getElementById('connection-text');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const themeToggle = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    const requiredEls = {
        canvas, ctx, container, onlineCountEl, userNameEl, userColorDot,
        leaderboardEl, yourCellsEl, yourRankEl, activityFeed, toastEl,
        toastTextEl, cooldownOverlay, cooldownBar, zoomLevelEl, tooltipEl,
        tooltipTextEl, connectionBanner, connectionText, sidebarToggle, sidebar
    };
    for (const [name, el] of Object.entries(requiredEls)) {
        if (!el) console.warn('Missing DOM element: ' + name);
    }
    if (!canvas || !ctx || !container) {
        console.error('Critical elements missing, aborting.');
        return;
    }

    function getTheme() {
        return document.documentElement.getAttribute('data-theme') || 'dark';
    }

    function applyTheme(theme) {
        if (theme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
            if (themeIcon) themeIcon.textContent = '\u263E';
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (themeIcon) themeIcon.textContent = '\u2600';
        }
        localStorage.setItem('gridlock-theme', theme);
        render();
    }

    const savedTheme = localStorage.getItem('gridlock-theme') || 'dark';
    applyTheme(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
        });
    }

    function isLightTheme() {
        return getTheme() === 'light';
    }

    function hslToHsla(hslStr, alpha) {
        const match = hslStr.match(/^hsl\(\s*(\d+),\s*([\d.]+)%,\s*([\d.]+)%\s*\)$/);
        if (match) {
            return `hsla(${match[1]}, ${match[2]}%, ${match[3]}%, ${alpha})`;
        }
        return `rgba(255, 255, 255, ${alpha})`;
    }

    const socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: Infinity
    });

    socket.on('welcome', (data) => {
        myUser = data.user;
        ROWS = data.config.rows;
        COLS = data.config.cols;
        COOLDOWN_MS = data.config.cooldownMs;

        cells.clear();
        for (const [key, cell] of Object.entries(data.gridState)) {
            cells.set(key, cell);
        }

        if (userNameEl) userNameEl.textContent = myUser.name;
        if (userColorDot) {
            userColorDot.style.background = myUser.color;
            userColorDot.style.boxShadow = `0 0 8px ${myUser.color}`;
        }

        updateLeaderboard(data.leaderboard);
        if (onlineCountEl) onlineCountEl.textContent = data.onlineCount;
        centerView();
        render();
    });

    socket.on('cell-claimed', (data) => {
        const key = `${data.row}:${data.col}`;
        cells.set(key, { owner: data.owner, color: data.color });

        claimAnimations.push({
            row: data.row, col: data.col, color: data.color,
            startTime: performance.now(), duration: 500
        });
        startAnimationLoop();

        const isSteal = !!data.previousOwner;
        const isMe = data.owner === myUser?.name;
        if (isMe) {
            const label = isSteal
                ? `You captured (${data.row},${data.col}) from <span class="activity-name">${escapeHtml(data.previousOwner)}</span>`
                : `You claimed (${data.row},${data.col})`;
            addActivity(label);
        } else {
            const label = isSteal
                ? `<span class="activity-name">${escapeHtml(data.owner)}</span> stole from ${escapeHtml(data.previousOwner)}`
                : `<span class="activity-name">${escapeHtml(data.owner)}</span> claimed (${data.row},${data.col})`;
            addActivity(label);
        }
        render();
    });

    socket.on('claim-rejected', (data) => {
        if (data.reason === 'cooldown') {
            showToast(`Cooldown! Wait ${((data.remainingMs || 0) / 1000).toFixed(1)}s`, 'error');
        } else if (data.reason === 'rate-limited') {
            showToast('Slow down! Rate limited.', 'error');
        } else {
            showToast(data.reason || 'Claim rejected', 'error');
        }
    });

    socket.on('leaderboard-update', (data) => updateLeaderboard(data));

    socket.on('user-joined', (data) => {
        if (onlineCountEl) onlineCountEl.textContent = data.onlineCount;
        addActivity(`<span class="activity-name">${escapeHtml(data.name)}</span> joined`);
        showToast(`${data.name} joined the grid`);
    });

    socket.on('user-left', (data) => {
        if (onlineCountEl) onlineCountEl.textContent = data.onlineCount;
        addActivity(`<span class="activity-name">${escapeHtml(data.name)}</span> left`);
        showToast(`${data.name} left the grid`);
    });

    socket.on('disconnect', () => {
        if (connectionBanner) connectionBanner.classList.remove('hidden', 'reconnected');
        if (connectionText) connectionText.textContent = 'Disconnected — Reconnecting...';
    });

    socket.on('reconnect', () => {
        if (connectionBanner) connectionBanner.classList.add('reconnected');
        if (connectionText) connectionText.textContent = 'Reconnected!';
        setTimeout(() => { if (connectionBanner) connectionBanner.classList.add('hidden'); }, 2000);
    });

    socket.on('connect', () => {
        if (connectionBanner && !connectionBanner.classList.contains('hidden')) {
            connectionBanner.classList.add('reconnected');
            if (connectionText) connectionText.textContent = 'Connected!';
            setTimeout(() => { if (connectionBanner) connectionBanner.classList.add('hidden'); }, 2000);
        }
    });

    window.addEventListener('beforeunload', () => socket.disconnect());

    function resizeCanvas() {
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * devicePixelRatio;
        canvas.height = rect.height * devicePixelRatio;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        render();
    }

    function render() {
        const w = canvas.width / devicePixelRatio;
        const h = canvas.height / devicePixelRatio;
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        const cellPx = CELL_SIZE;
        const gridW = COLS * cellPx;
        const gridH = ROWS * cellPx;
        const visMinX = Math.max(0, Math.floor(-panX / zoom / cellPx));
        const visMinY = Math.max(0, Math.floor(-panY / zoom / cellPx));
        const visMaxX = Math.min(COLS, Math.ceil((w - panX) / zoom / cellPx));
        const visMaxY = Math.min(ROWS, Math.ceil((h - panY) / zoom / cellPx));

        for (const [key, cell] of cells) {
            const [r, c] = key.split(':').map(Number);
            if (c < visMinX || c >= visMaxX || r < visMinY || r >= visMaxY) continue;
            ctx.fillStyle = cell.color;
            ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
            ctx.fillStyle = isLightTheme() ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)';
            ctx.fillRect(c * cellPx + 1, r * cellPx + 1, cellPx - 2, 2);
            ctx.fillRect(c * cellPx + 1, r * cellPx + 1, 2, cellPx - 2);
        }

        ctx.strokeStyle = isLightTheme() ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        for (let c = visMinX; c <= visMaxX; c++) {
            ctx.moveTo(c * cellPx, visMinY * cellPx);
            ctx.lineTo(c * cellPx, visMaxY * cellPx);
        }
        for (let r = visMinY; r <= visMaxY; r++) {
            ctx.moveTo(visMinX * cellPx, r * cellPx);
            ctx.lineTo(visMaxX * cellPx, r * cellPx);
        }
        ctx.stroke();

        ctx.strokeStyle = isLightTheme() ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, gridW, gridH);

        if (hoverCell && hoverCell.row >= 0 && hoverCell.row < ROWS && hoverCell.col >= 0 && hoverCell.col < COLS) {
            const hKey = `${hoverCell.row}:${hoverCell.col}`;
            const owned = cells.get(hKey);
            ctx.strokeStyle = myUser ? myUser.color : '#fff';
            ctx.lineWidth = 2;
            ctx.strokeRect(hoverCell.col * cellPx + 1, hoverCell.row * cellPx + 1, cellPx - 2, cellPx - 2);
            if (!owned) {
                ctx.fillStyle = myUser ? hslToHsla(myUser.color, 0.15) : (isLightTheme() ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)');
                ctx.fillRect(hoverCell.col * cellPx, hoverCell.row * cellPx, cellPx, cellPx);
            }
        }

        const now = performance.now();
        for (let i = claimAnimations.length - 1; i >= 0; i--) {
            const anim = claimAnimations[i];
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            if (progress >= 1) { claimAnimations.splice(i, 1); continue; }
            const maxRadius = cellPx * 1.8;
            const radius = maxRadius * easeOutCubic(progress);
            const alpha = (1 - easeOutCubic(progress)) * 0.6;
            const cx = anim.col * cellPx + cellPx / 2;
            const cy = anim.row * cellPx + cellPx / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = hslToHsla(anim.color, alpha);
            ctx.lineWidth = 2 * (1 - progress);
            ctx.stroke();
        }
        ctx.restore();
    }

    function startAnimationLoop() {
        if (animationRunning) return;
        animationRunning = true;
        function tick() {
            if (claimAnimations.length === 0) { animationRunning = false; return; }
            render();
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

    function centerView() {
        const rect = container.getBoundingClientRect();
        panX = (rect.width - COLS * CELL_SIZE * zoom) / 2;
        panY = (rect.height - ROWS * CELL_SIZE * zoom) / 2;
    }

    function setZoom(newZoom, pivotX, pivotY) {
        const oldZoom = zoom;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
        panX = pivotX - (pivotX - panX) * (zoom / oldZoom);
        panY = pivotY - (pivotY - panY) * (zoom / oldZoom);
        if (zoomLevelEl) zoomLevelEl.textContent = Math.round(zoom * 100) + '%';
        render();
    }

    function screenToGrid(sx, sy) {
        const col = Math.floor((sx - panX) / zoom / CELL_SIZE);
        const row = Math.floor((sy - panY) / zoom / CELL_SIZE);
        return { row, col };
    }

    function scheduleRender() {
        if (renderPending) return;
        renderPending = true;
        requestAnimationFrame(() => { renderPending = false; render(); });
    }

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(zoom + delta * zoom, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            isPanning = true;
            panStartX = e.clientX;
            panStartY = e.clientY;
            panStartPanX = panX;
            panStartPanY = panY;
            container.classList.add('panning');
        }
    });

    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (isPanning) {
            panX = panStartPanX + (e.clientX - panStartX);
            panY = panStartPanY + (e.clientY - panStartY);
            scheduleRender();
            return;
        }

        const cell = screenToGrid(mx, my);
        if (cell.row >= 0 && cell.row < ROWS && cell.col >= 0 && cell.col < COLS) {
            hoverCell = cell;
            const key = `${cell.row}:${cell.col}`;
            const owned = cells.get(key);
            if (owned && tooltipEl && tooltipTextEl) {
                tooltipTextEl.textContent = `${owned.owner}'s territory`;
                tooltipEl.style.left = e.clientX + 'px';
                tooltipEl.style.top = (e.clientY - 8) + 'px';
                tooltipEl.classList.add('visible');
            } else if (tooltipEl) {
                tooltipEl.classList.remove('visible');
            }
        } else {
            hoverCell = null;
            if (tooltipEl) tooltipEl.classList.remove('visible');
        }
        scheduleRender();
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0 && isPanning) {
            const dx = Math.abs(e.clientX - panStartX);
            const dy = Math.abs(e.clientY - panStartY);
            isPanning = false;
            container.classList.remove('panning');
            if (dx < 5 && dy < 5) {
                const rect = canvas.getBoundingClientRect();
                handleCellClick(e.clientX - rect.left, e.clientY - rect.top);
            }
        }
    });

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            touchStartTime = Date.now();
            touchStartPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            touchMoved = false;
            isPanning = true;
            panStartX = e.touches[0].clientX;
            panStartY = e.touches[0].clientY;
            panStartPanX = panX;
            panStartPanY = panY;
        } else if (e.touches.length === 2) {
            isPanning = false;
            lastPinchDist = getPinchDist(e.touches);
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && isPanning) {
            const dx = e.touches[0].clientX - panStartX;
            const dy = e.touches[0].clientY - panStartY;
            if (Math.abs(dx) > 10 || Math.abs(dy) > 10) touchMoved = true;
            panX = panStartPanX + dx;
            panY = panStartPanY + dy;
            scheduleRender();
        } else if (e.touches.length === 2) {
            const newDist = getPinchDist(e.touches);
            const rect = canvas.getBoundingClientRect();
            const mid = getPinchMid(e.touches);
            setZoom(zoom * (newDist / lastPinchDist), mid.x - rect.left, mid.y - rect.top);
            lastPinchDist = newDist;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        if (e.touches.length === 0) {
            isPanning = false;
            if (Date.now() - touchStartTime < 200 && !touchMoved) {
                const rect = canvas.getBoundingClientRect();
                handleCellClick(touchStartPos.x - rect.left, touchStartPos.y - rect.top);
            }
        }
    });

    function getPinchDist(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getPinchMid(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function handleCellClick(mx, my) {
        if (!myUser) return;
        const cell = screenToGrid(mx, my);
        if (cell.row < 0 || cell.row >= ROWS || cell.col < 0 || cell.col >= COLS) return;

        const now = Date.now();
        if (now < cooldownEndTime) {
            showToast(`Cooldown: ${((cooldownEndTime - now) / 1000).toFixed(1)}s`, 'error');
            return;
        }

        socket.emit('claim-cell', { row: cell.row, col: cell.col });
        cooldownEndTime = now + COOLDOWN_MS;
        startCooldownAnimation();
    }

    function startCooldownAnimation() {
        if (cooldownOverlay) cooldownOverlay.classList.remove('hidden');
        cancelAnimationFrame(cooldownRAF);

        function update() {
            const remaining = cooldownEndTime - Date.now();
            if (remaining <= 0) {
                if (cooldownOverlay) cooldownOverlay.classList.add('hidden');
                if (cooldownBar) cooldownBar.style.width = '0%';
                cooldownRAF = 0;
                return;
            }
            if (cooldownBar) cooldownBar.style.width = ((1 - remaining / COOLDOWN_MS) * 100) + '%';
            cooldownRAF = requestAnimationFrame(update);
        }
        update();
    }

    document.getElementById('zoom-in')?.addEventListener('click', () => {
        const rect = container.getBoundingClientRect();
        setZoom(zoom + ZOOM_STEP * zoom, rect.width / 2, rect.height / 2);
    });

    document.getElementById('zoom-out')?.addEventListener('click', () => {
        const rect = container.getBoundingClientRect();
        setZoom(zoom - ZOOM_STEP * zoom, rect.width / 2, rect.height / 2);
    });

    document.getElementById('zoom-reset')?.addEventListener('click', () => {
        zoom = 1;
        centerView();
        if (zoomLevelEl) zoomLevelEl.textContent = '100%';
        render();
    });

    if (sidebarToggle && sidebar) {
        sidebarToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            setTimeout(resizeCanvas, 320);
        });
    }

    function updateLeaderboard(data) {
        leaderboard = data;
        if (!leaderboardEl) return;
        leaderboardEl.innerHTML = '';

        if (data.length === 0) {
            leaderboardEl.innerHTML = '<li class="leaderboard-empty">No claims yet</li>';
            if (yourCellsEl) yourCellsEl.textContent = '0';
            if (yourRankEl) yourRankEl.textContent = '\u2014';
            return;
        }

        leaderboard.forEach((entry, i) => {
            const li = document.createElement('li');
            li.className = 'leaderboard-item';
            if (myUser && entry.name === myUser.name) li.classList.add('is-you');
            const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
            li.innerHTML = `
        <span class="lb-rank ${rankClass}">${i + 1}</span>
        <span class="lb-color" style="background:${entry.color};box-shadow:0 0 6px ${entry.color}"></span>
        <span class="lb-name">${escapeHtml(entry.name)}${myUser && entry.name === myUser.name ? ' (you)' : ''}</span>
        <span class="lb-count">${entry.count}</span>
      `;
            leaderboardEl.appendChild(li);
        });

        if (myUser) {
            const myEntry = leaderboard.find(e => e.name === myUser.name);
            if (yourCellsEl) yourCellsEl.textContent = myEntry ? myEntry.count : '0';
            const myRankIdx = leaderboard.findIndex(e => e.name === myUser.name);
            if (yourRankEl) yourRankEl.textContent = myRankIdx >= 0 ? `#${myRankIdx + 1}` : '\u2014';
        }
    }

    const MAX_ACTIVITY = 20;

    function addActivity(html) {
        if (!activityFeed) return;
        const empty = activityFeed.querySelector('.activity-empty');
        if (empty) empty.remove();
        const li = document.createElement('li');
        li.className = 'activity-item';
        li.innerHTML = html;
        activityFeed.prepend(li);
        while (activityFeed.children.length > MAX_ACTIVITY) {
            activityFeed.removeChild(activityFeed.lastChild);
        }
    }

    let toastTimeout = null;
    function showToast(text, type = '') {
        if (!toastEl || !toastTextEl) return;
        toastTextEl.textContent = text;
        toastEl.className = 'toast visible ' + type;
        if (toastTimeout) clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => toastEl.classList.remove('visible'), 2000);
    }

    function escapeHtml(str) {
        const div = document.createElement('span');
        div.textContent = str;
        return div.innerHTML;
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            zoom = 1;
            centerView();
            if (zoomLevelEl) zoomLevelEl.textContent = '100%';
            render();
        }
    });

})();
