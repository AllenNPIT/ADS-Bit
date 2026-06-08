// ADS-Bit Admin Panel
(function () {
    const loginScreen = document.getElementById('login-screen');
    const adminPanel = document.getElementById('admin-panel');
    let statusInterval = null;

    // ------- Auth -------
    async function checkAuth() {
        try {
            const res = await fetch('/api/auth/check');
            if (res.ok) {
                showAdmin();
                return;
            }
        } catch (e) { /* not logged in */ }
        showLogin();
    }

    function showLogin() {
        loginScreen.classList.remove('hidden');
        adminPanel.classList.add('hidden');
        if (statusInterval) clearInterval(statusInterval);
    }

    function showAdmin() {
        loginScreen.classList.add('hidden');
        adminPanel.classList.remove('hidden');
        loadConfig();
        loadThemes();
        refreshStatus();
        statusInterval = setInterval(refreshStatus, 5000);
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const pw = document.getElementById('login-password').value;
        const errEl = document.getElementById('login-error');
        errEl.classList.add('hidden');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (res.ok) {
                showAdmin();
            } else {
                const data = await res.json();
                errEl.textContent = data.error || 'Login failed';
                errEl.classList.remove('hidden');
            }
        } catch (err) {
            errEl.textContent = 'Connection error';
            errEl.classList.remove('hidden');
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        showLogin();
    });

    // ------- Tabs -------
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.remove('hidden');
            // Lazy-load sprites on first visit
            if (tab.dataset.tab === 'sprites' && !spritesLoaded) {
                spritesLoaded = true;
                loadSprites();
            }
        });
    });

    // ------- Dashboard -------
    async function refreshStatus() {
        try {
            const res = await fetch('/api/admin/status');
            if (!res.ok) return;
            const data = await res.json();
            document.getElementById('stat-flights').textContent = data.active_flights;
            document.getElementById('stat-viewers').textContent = data.connected_viewers;
            document.getElementById('stat-receivers').textContent = data.receiver_count;
            document.getElementById('stat-uptime').textContent = data.uptime;

            const ipsEl = document.getElementById('receiver-ips');
            if (data.receivers && data.receivers.length) {
                ipsEl.textContent = data.receivers.join(', ');
            } else {
                ipsEl.textContent = 'None connected';
            }
        } catch (e) { /* ignore */ }
    }

    // ------- Load Config -------
    async function loadConfig() {
        try {
            const res = await fetch('/api/admin/config');
            if (!res.ok) return;
            const cfg = await res.json();

            // Receivers
            const mode = (cfg.receivers === 'AUTO') ? 'AUTO' : 'MANUAL';
            document.getElementById('receiver-mode').value = mode;
            toggleManualIps(mode);
            if (mode === 'MANUAL') {
                const ips = Array.isArray(cfg.receivers) ? cfg.receivers : [cfg.receivers];
                document.getElementById('receiver-ips-input').value = ips.join('\n');
            }
            document.getElementById('receiver-port').value = cfg.receiver_port || 30003;

            // Location
            document.getElementById('location-name').value = cfg.location?.name || '';
            document.getElementById('location-lat').value = cfg.location?.lat || 0;
            document.getElementById('location-lon').value = cfg.location?.lon || 0;

            // Display
            document.getElementById('site-title').value = cfg.site?.title || 'ADS-Bit';
            document.getElementById('site-subtitle').value = cfg.site?.subtitle || '';
            document.getElementById('temp-unit').value = cfg.display?.temperature_unit || 'F';
            document.getElementById('show-weather').checked = cfg.display?.show_weather !== false;
            document.getElementById('show-sidebar').checked = cfg.display?.show_sidebar !== false;
            document.getElementById('default-direction').value = cfg.display?.default_view_direction || 0;

            // Set theme select to current theme
            const themeSelect = document.getElementById('theme-select');
            if (themeSelect.options.length > 0) {
                themeSelect.value = cfg.theme || 'desert';
            } else {
                themeSelect.dataset.pending = cfg.theme || 'desert';
            }

            // Tuning
            document.getElementById('flight-timeout').value = cfg.tuning?.flight_timeout_seconds || 60;
            document.getElementById('broadcast-interval').value = cfg.tuning?.broadcast_interval_seconds || 1;
            document.getElementById('cleanup-interval').value = cfg.tuning?.cleanup_interval_seconds || 10;
            document.getElementById('reconnect-delay').value = cfg.tuning?.receiver_reconnect_seconds || 5;
        } catch (e) {
            console.error('Failed to load config', e);
        }
    }

    // ------- Load Themes -------
    async function loadThemes() {
        try {
            const res = await fetch('/api/admin/themes');
            if (!res.ok) return;
            const data = await res.json();
            const sel = document.getElementById('theme-select');
            sel.innerHTML = '';
            (data.themes || []).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
                sel.appendChild(opt);
            });
            // Apply pending value if config loaded first
            if (sel.dataset.pending) {
                sel.value = sel.dataset.pending;
                delete sel.dataset.pending;
            }
        } catch (e) { /* ignore */ }
    }

    // ------- Receivers -------
    function toggleManualIps(mode) {
        document.getElementById('manual-ips-group').classList.toggle('hidden', mode === 'AUTO');
    }

    document.getElementById('receiver-mode').addEventListener('change', (e) => {
        toggleManualIps(e.target.value);
    });

    document.getElementById('scan-receivers-btn').addEventListener('click', async () => {
        const btn = document.getElementById('scan-receivers-btn');
        btn.textContent = 'SCANNING...';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/scan-receivers', { method: 'POST' });
            const data = await res.json();
            const box = document.getElementById('scan-results');
            const list = document.getElementById('scan-results-list');
            box.classList.remove('hidden');
            if (data.receivers && data.receivers.length) {
                list.textContent = data.receivers.join(', ');
            } else {
                list.textContent = 'No receivers found on network';
            }
        } catch (e) {
            toast('Scan failed', true);
        }
        btn.textContent = 'SCAN NOW';
        btn.disabled = false;
    });

    document.getElementById('restart-receivers-btn').addEventListener('click', async () => {
        try {
            const res = await fetch('/api/admin/restart-receivers', { method: 'POST' });
            if (res.ok) toast('Receivers restarted');
            else toast('Failed to restart', true);
        } catch (e) {
            toast('Error restarting receivers', true);
        }
    });

    document.getElementById('save-receivers-btn').addEventListener('click', async () => {
        const mode = document.getElementById('receiver-mode').value;
        const port = parseInt(document.getElementById('receiver-port').value) || 30003;
        const body = { receiver_port: port };

        if (mode === 'AUTO') {
            body.receivers = 'AUTO';
        } else {
            const ips = document.getElementById('receiver-ips-input').value
                .split('\n').map(s => s.trim()).filter(Boolean);
            body.receivers = ips.length ? ips : 'AUTO';
        }

        await saveConfig(body);
    });

    // ------- Location -------
    document.getElementById('browser-location-btn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            toast('Geolocation not supported', true);
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                document.getElementById('location-lat').value = pos.coords.latitude.toFixed(4);
                document.getElementById('location-lon').value = pos.coords.longitude.toFixed(4);
                toast('Location detected');
            },
            () => toast('Location access denied', true)
        );
    });

    document.getElementById('save-location-btn').addEventListener('click', async () => {
        await saveConfig({
            location: {
                name: document.getElementById('location-name').value,
                lat: parseFloat(document.getElementById('location-lat').value) || 0,
                lon: parseFloat(document.getElementById('location-lon').value) || 0
            }
        });
    });

    // ------- Display -------
    document.getElementById('save-display-btn').addEventListener('click', async () => {
        await saveConfig({
            theme: document.getElementById('theme-select').value,
            site: {
                title: document.getElementById('site-title').value,
                subtitle: document.getElementById('site-subtitle').value
            },
            display: {
                temperature_unit: document.getElementById('temp-unit').value,
                show_weather: document.getElementById('show-weather').checked,
                show_sidebar: document.getElementById('show-sidebar').checked,
                default_view_direction: parseInt(document.getElementById('default-direction').value) || 0
            }
        });
    });

    // ------- Tuning -------
    document.getElementById('save-tuning-btn').addEventListener('click', async () => {
        await saveConfig({
            tuning: {
                flight_timeout_seconds: parseInt(document.getElementById('flight-timeout').value) || 60,
                broadcast_interval_seconds: parseInt(document.getElementById('broadcast-interval').value) || 1,
                cleanup_interval_seconds: parseInt(document.getElementById('cleanup-interval').value) || 10,
                receiver_reconnect_seconds: parseInt(document.getElementById('reconnect-delay').value) || 5
            }
        });
    });

    // ------- Security -------
    document.getElementById('change-password-btn').addEventListener('click', async () => {
        const current = document.getElementById('current-password').value;
        const newPw = document.getElementById('new-password').value;
        const confirm = document.getElementById('confirm-password').value;

        if (newPw.length < 4) {
            toast('Password must be at least 4 characters', true);
            return;
        }
        if (newPw !== confirm) {
            toast('Passwords do not match', true);
            return;
        }

        try {
            const res = await fetch('/api/admin/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ current_password: current, new_password: newPw })
            });
            if (res.ok) {
                toast('Password changed');
                document.getElementById('current-password').value = '';
                document.getElementById('new-password').value = '';
                document.getElementById('confirm-password').value = '';
            } else {
                const data = await res.json();
                toast(data.error || 'Failed to change password', true);
            }
        } catch (e) {
            toast('Connection error', true);
        }
    });

    // ------- Sprites -------
    let spritesLoaded = false;

    async function loadSprites() {
        try {
            const res = await fetch('/api/admin/sprites');
            if (!res.ok) return;
            const data = await res.json();
            const grid = document.getElementById('sprite-grid');
            if (!grid) return;

            grid.innerHTML = '';
            (data.sprites || []).forEach(sprite => {
                const card = document.createElement('div');
                card.className = 'sprite-card';

                const cacheBust = Date.now();
                const imgHtml = sprite.exists
                    ? `<img src="${sprite.url}?v=${cacheBust}" alt="${sprite.type}">`
                    : `<span class="no-sprite">No sprite</span>`;

                card.innerHTML = `
                    <h4>${sprite.type}</h4>
                    <div class="sprite-categories">${sprite.categories || ''}</div>
                    <div class="sprite-preview">${imgHtml}</div>
                    <label class="sprite-upload-label">
                        UPLOAD
                        <input type="file" class="sprite-upload-input" accept=".png,image/png" data-type="${sprite.type}">
                    </label>
                `;

                const fileInput = card.querySelector('.sprite-upload-input');
                fileInput.addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;

                    if (!file.type.includes('png')) {
                        toast('Only PNG files are allowed', true);
                        e.target.value = '';
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                        const uploadRes = await fetch(`/api/admin/sprites/${sprite.type}`, {
                            method: 'POST',
                            body: formData
                        });
                        if (uploadRes.ok) {
                            toast(`${sprite.type} sprite updated`);
                            loadSprites(); // Refresh previews
                        } else {
                            const err = await uploadRes.json();
                            toast(err.error || 'Upload failed', true);
                        }
                    } catch (err) {
                        toast('Upload error', true);
                    }
                    e.target.value = '';
                });

                grid.appendChild(card);
            });
        } catch (e) {
            console.error('Failed to load sprites', e);
        }
    }

    // ------- Helpers -------
    async function saveConfig(body) {
        try {
            const res = await fetch('/api/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                toast('Settings saved');
            } else {
                const data = await res.json();
                toast(data.error || 'Save failed', true);
            }
        } catch (e) {
            toast('Connection error', true);
        }
    }

    function toast(msg, isError) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.remove('hidden', 'error');
        if (isError) el.classList.add('error');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('hidden'), 3000);
    }

    // ------- Init -------
    checkAuth();
})();
