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
        loadNetworkInfo();
        loadVersion();
        refreshStatus();
        statusInterval = setInterval(refreshStatus, 5000);
    }

    async function loadVersion() {
        try {
            const res = await fetch('/api/config');
            if (!res.ok) return;
            const data = await res.json();
            if (data.version) {
                document.getElementById('admin-version').textContent = 'v' + data.version;
            }
        } catch (e) { /* ignore */ }
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
            // Lazy-load theme manager on first visit
            if (tab.dataset.tab === 'themes' && !themesManagerLoaded) {
                themesManagerLoaded = true;
                loadThemeManager();
            }
            // Live receiver health polling only while the Receivers tab is open
            if (tab.dataset.tab === 'receivers') {
                startReceiverStatusPolling();
            } else {
                stopReceiverStatusPolling();
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

    // ------- Load Themes (Display tab dropdown) -------
    async function loadThemes() {
        try {
            const res = await fetch('/api/admin/themes');
            if (!res.ok) return;
            const data = await res.json();
            const sel = document.getElementById('theme-select');
            sel.innerHTML = '';
            (data.themes || []).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                sel.appendChild(opt);
            });
            // Apply pending value if config loaded first
            if (sel.dataset.pending) {
                sel.value = sel.dataset.pending;
                delete sel.dataset.pending;
            }
        } catch (e) { /* ignore */ }
    }

    // ------- Network Info -------
    async function loadNetworkInfo() {
        const el = document.getElementById('network-info');
        if (!el) return;
        try {
            const res = await fetch('/api/admin/network-info');
            if (!res.ok) { el.textContent = 'Failed to load'; return; }
            const data = await res.json();
            const ifaces = data.interfaces || [];
            if (!ifaces.length) {
                el.textContent = 'No network interfaces found';
                return;
            }
            let html = '<table class="network-info-table">';
            html += '<tr><th>Interface</th><th>IP Address</th><th>Network</th></tr>';
            ifaces.forEach(i => {
                html += `<tr><td>${i.name}</td><td>${i.ip}</td><td>${i.network}</td></tr>`;
            });
            html += '</table>';
            el.innerHTML = html;

            populateScanInterfaces(ifaces);
        } catch (e) {
            el.textContent = 'Error loading network info';
        }
    }

    // Build the "Interface / Subnet to Scan" dropdown from the host interfaces.
    // Subnets larger than /20 (>4094 hosts) are disabled — the server rejects
    // them anyway, and scanning e.g. a docker /16 is impractically slow.
    const MAX_SCAN_HOSTS = 4094;
    function populateScanInterfaces(ifaces) {
        const sel = document.getElementById('scan-interface');
        if (!sel) return;
        sel.innerHTML = '';

        const allOpt = document.createElement('option');
        allOpt.value = '';
        allOpt.textContent = 'All local subnets (slower)';
        sel.appendChild(allOpt);

        let firstScannable = null;
        ifaces.forEach(i => {
            const prefix = parseInt((i.network.split('/')[1]) || '0', 10);
            const hosts = Math.max(0, Math.pow(2, 32 - prefix) - 2);
            const opt = document.createElement('option');
            opt.value = i.network;
            const tooBig = hosts > MAX_SCAN_HOSTS;
            opt.textContent = `${i.name} — ${i.network} (${hosts} hosts)` + (tooBig ? ' — too large' : '');
            opt.disabled = tooBig;
            sel.appendChild(opt);
            if (!tooBig && firstScannable === null) firstScannable = i.network;
        });

        // Default to the first reasonably-sized interface for a fast scan.
        if (firstScannable !== null) sel.value = firstScannable;
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
            // Custom subnet text overrides the interface dropdown selection.
            const custom = (document.getElementById('scan-subnet').value || '').trim();
            const iface = document.getElementById('scan-interface').value || '';
            const subnet = custom || iface;
            const fetchOpts = { method: 'POST' };
            if (subnet) {
                fetchOpts.headers = { 'Content-Type': 'application/json' };
                fetchOpts.body = JSON.stringify({ subnet });
            }
            const res = await fetch('/api/admin/scan-receivers', fetchOpts);
            const data = await res.json();
            renderScanResults(data);
        } catch (e) {
            toast('Scan failed', true);
        }
        btn.textContent = 'SCAN NOW';
        btn.disabled = false;
    });

    // Render scan results as a selectable checklist.
    function renderScanResults(data) {
        const box = document.getElementById('scan-results');
        const list = document.getElementById('scan-results-list');
        const useRow = document.getElementById('scan-use-row');
        box.classList.remove('hidden');
        list.innerHTML = '';

        if (data.error) {
            list.textContent = data.error;
            useRow.style.display = 'none';
            return;
        }
        const found = data.receivers || [];
        if (!found.length) {
            list.textContent = 'No receivers found on network';
            useRow.style.display = 'none';
            return;
        }

        // Pre-check IPs already in the manual list.
        const current = new Set(document.getElementById('receiver-ips-input').value
            .split('\n').map(s => s.trim()).filter(Boolean));

        found.forEach(ip => {
            const row = document.createElement('label');
            row.className = 'rx-scan-item';
            row.innerHTML = `
                <input type="checkbox" value="${ip}" ${current.has(ip) ? 'checked' : ''}>
                <span class="rx-scan-ip">${ip}</span>`;
            list.appendChild(row);
        });
        useRow.style.display = '';
    }

    // "USE SELECTED" -> switch to MANUAL, populate IPs, save & apply.
    document.getElementById('use-selected-btn').addEventListener('click', async () => {
        const checked = Array.from(
            document.querySelectorAll('#scan-results-list input[type="checkbox"]:checked')
        ).map(cb => cb.value);
        if (!checked.length) { toast('Select at least one receiver', true); return; }

        document.getElementById('receiver-mode').value = 'MANUAL';
        toggleManualIps('MANUAL');
        document.getElementById('receiver-ips-input').value = checked.join('\n');
        await saveAndApplyReceivers();
    });

    document.getElementById('restart-receivers-btn').addEventListener('click', async () => {
        const btn = document.getElementById('restart-receivers-btn');
        const orig = btn.textContent;
        btn.textContent = 'RESTARTING…';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/restart-receivers', { method: 'POST' });
            if (res.ok) { toast('Receivers restarted'); await testReceivers(); }
            else toast('Failed to restart', true);
        } catch (e) {
            toast('Error restarting receivers', true);
        }
        btn.textContent = orig;
        btn.disabled = false;
    });

    document.getElementById('save-receivers-btn').addEventListener('click', saveAndApplyReceivers);

    // Save the receiver selection, reconnect, then re-test — the full
    // select -> save -> verify loop in one action.
    async function saveAndApplyReceivers() {
        const btn = document.getElementById('save-receivers-btn');
        const orig = btn.textContent;
        const mode = document.getElementById('receiver-mode').value;
        const port = parseInt(document.getElementById('receiver-port').value) || 30003;
        const body = { receiver_port: port };

        if (mode === 'AUTO') {
            body.receivers = 'AUTO';
        } else {
            const ips = document.getElementById('receiver-ips-input').value
                .split('\n').map(s => s.trim()).filter(Boolean);
            if (!ips.length) { toast('Enter at least one receiver IP', true); return; }
            body.receivers = ips;
        }

        btn.textContent = 'APPLYING…';
        btn.disabled = true;
        try {
            const saved = await saveConfig(body, true);
            if (saved) {
                // Apply immediately so the active list reflects the new selection.
                await fetch('/api/admin/restart-receivers', { method: 'POST' });
                await testReceivers();
                toast('Saved & applied — testing connections');
            }
        } catch (e) {
            toast('Failed to apply', true);
        }
        btn.textContent = orig;
        btn.disabled = false;
    }

    // ------- Receiver status / health -------
    let receiverStatusInterval = null;

    function startReceiverStatusPolling() {
        loadReceiverStatus();
        if (!receiverStatusInterval) {
            receiverStatusInterval = setInterval(loadReceiverStatus, 4000);
        }
    }

    function stopReceiverStatusPolling() {
        if (receiverStatusInterval) {
            clearInterval(receiverStatusInterval);
            receiverStatusInterval = null;
        }
    }

    async function loadReceiverStatus() {
        const list = document.getElementById('receiver-status-list');
        try {
            const res = await fetch('/api/admin/receiver-status');
            if (!res.ok) {
                // 404 here almost always means the server is running an older
                // build without this endpoint — tell the user instead of
                // leaving a silent "Loading…".
                if (res.status === 404) {
                    list.innerHTML = '<span class="no-sprite">Status endpoint not found — ' +
                        'restart the server to load the latest build.</span>';
                }
                return;
            }
            const data = await res.json();
            renderReceiverStatus(data.receivers || [], data.configured);
        } catch (e) {
            // Only replace the initial placeholder; don't clobber good data on
            // a transient poll failure.
            if (/Loading/.test(list.textContent)) {
                list.innerHTML = '<span class="no-sprite">Could not reach server.</span>';
            }
        }
    }

    document.getElementById('test-receivers-btn').addEventListener('click', testReceivers);

    async function testReceivers() {
        const btn = document.getElementById('test-receivers-btn');
        const orig = btn.textContent;
        btn.textContent = 'TESTING…';
        btn.disabled = true;
        try {
            const res = await fetch('/api/admin/test-receivers', { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                renderReceiverStatus(data.receivers || [], undefined, true);
            } else {
                toast('Test failed', true);
            }
        } catch (e) {
            toast('Test error', true);
        }
        btn.textContent = orig;
        btn.disabled = false;
    }

    function renderReceiverStatus(statuses, configured, tested) {
        const list = document.getElementById('receiver-status-list');
        const summary = document.getElementById('receiver-status-summary');

        if (configured !== undefined) {
            const modeLabel = (configured === 'AUTO') ? 'AUTO' : 'MANUAL';
            summary.textContent = `(${statuses.length} • ${modeLabel})`;
        }

        if (!statuses.length) {
            list.innerHTML = '<span class="no-sprite">No receivers configured. ' +
                'Use AUTO mode or add IPs below, then SAVE &amp; APPLY.</span>';
            return;
        }

        list.innerHTML = '';
        statuses.forEach(s => {
            const row = document.createElement('div');
            row.className = 'rx-status-item';
            const detail = s.last_msg_age != null
                ? `${s.msg_count} msgs · last ${s.last_msg_age}s ago`
                : (s.state === 'down' ? (tested ? 'no response on port' : 'not connected')
                                      : 'waiting for data…');
            row.innerHTML = `
                <span class="rx-dot ${s.color}"></span>
                <span class="rx-ip">${s.ip}</span>
                <span class="rx-label rx-${s.color}">${s.label}</span>
                <span class="rx-detail">${detail}</span>`;
            list.appendChild(row);
        });
    }

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

    // ------- Theme Manager -------
    let themesManagerLoaded = false;

    async function loadThemeManager() {
        try {
            const res = await fetch('/api/admin/themes');
            if (!res.ok) return;
            const data = await res.json();
            const grid = document.getElementById('theme-grid');
            if (!grid) return;

            const activeTheme = data.active || '';
            grid.innerHTML = '';

            (data.themes || []).forEach(theme => {
                const card = document.createElement('div');
                card.className = 'theme-card';

                const isActive = theme.id === activeTheme;
                const badgeHtml = isActive ? '<span class="theme-active-badge">ACTIVE</span>' : '';
                const cacheBust = Date.now();

                let directionsHtml = '';
                ['north', 'east', 'south', 'west'].forEach(dir => {
                    const hasImage = theme.directions[dir];
                    const imgHtml = hasImage
                        ? `<img src="/backgrounds/${theme.id}/${dir}.png?v=${cacheBust}" alt="${dir}">`
                        : `<span class="no-sprite">No image</span>`;
                    const downloadLink = hasImage
                        ? `<a href="/backgrounds/${theme.id}/${dir}.png" download="${theme.id}_${dir}.png" class="sprite-upload-label">DOWNLOAD</a>`
                        : '';
                    directionsHtml += `
                        <div class="theme-dir-cell">
                            <div class="theme-dir-label">${dir.toUpperCase()}</div>
                            <div class="theme-dir-preview">${imgHtml}</div>
                            <div class="sprite-btn-row">
                                <label class="sprite-upload-label">
                                    UPLOAD
                                    <input type="file" class="theme-upload-input" accept=".png,image/png"
                                           data-theme="${theme.id}" data-direction="${dir}">
                                </label>
                                ${downloadLink}
                            </div>
                        </div>
                    `;
                });

                card.innerHTML = `
                    <div class="theme-card-header">
                        <div class="theme-card-title">
                            <input type="text" class="theme-name-input" value="${theme.name}" data-theme="${theme.id}">
                            <button class="btn btn-small theme-rename-btn" data-theme="${theme.id}">RENAME</button>
                            ${badgeHtml}
                        </div>
                    </div>
                    <div class="theme-directions">${directionsHtml}</div>
                `;

                // Rename handler
                const renameBtn = card.querySelector('.theme-rename-btn');
                const nameInput = card.querySelector('.theme-name-input');
                renameBtn.addEventListener('click', async () => {
                    const newName = nameInput.value.trim();
                    if (!newName) { toast('Name cannot be empty', true); return; }
                    try {
                        const r = await fetch(`/api/admin/themes/${theme.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: newName })
                        });
                        if (r.ok) {
                            toast('Theme renamed');
                            loadThemes(); // refresh Display tab dropdown
                        } else {
                            const err = await r.json();
                            toast(err.error || 'Rename failed', true);
                        }
                    } catch (e) { toast('Connection error', true); }
                });

                // Upload handlers
                card.querySelectorAll('.theme-upload-input').forEach(input => {
                    input.addEventListener('change', async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        if (!file.type.includes('png')) {
                            toast('Only PNG files are allowed', true);
                            e.target.value = '';
                            return;
                        }
                        const formData = new FormData();
                        formData.append('file', file);
                        const tid = input.dataset.theme;
                        const dir = input.dataset.direction;
                        try {
                            const r = await fetch(`/api/admin/themes/${tid}/${dir}`, {
                                method: 'POST',
                                body: formData
                            });
                            if (r.ok) {
                                toast(`${dir} background updated`);
                                loadThemeManager(); // refresh previews
                            } else {
                                const err = await r.json();
                                toast(err.error || 'Upload failed', true);
                            }
                        } catch (err) { toast('Upload error', true); }
                        e.target.value = '';
                    });
                });

                grid.appendChild(card);
            });
        } catch (e) {
            console.error('Failed to load theme manager', e);
        }
    }

    // Create theme handler
    document.getElementById('create-theme-btn').addEventListener('click', async () => {
        const nameInput = document.getElementById('new-theme-name');
        const name = nameInput.value.trim();
        if (!name) { toast('Enter a theme name', true); return; }
        try {
            const res = await fetch('/api/admin/themes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            if (res.ok) {
                nameInput.value = '';
                toast('Theme created');
                loadThemeManager();
                loadThemes(); // refresh Display tab dropdown
            } else {
                const err = await res.json();
                toast(err.error || 'Create failed', true);
            }
        } catch (e) { toast('Connection error', true); }
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

                const downloadHtml = sprite.exists
                    ? `<a href="${sprite.url}" download="${sprite.type}.png" class="sprite-upload-label">DOWNLOAD</a>`
                    : '';

                card.innerHTML = `
                    <h4>${sprite.type}</h4>
                    <div class="sprite-categories">${sprite.categories || ''}</div>
                    <div class="sprite-preview">${imgHtml}</div>
                    <div class="sprite-btn-row">
                        <button class="sprite-upload-label sprite-edit-btn" data-type="${sprite.type}">EDIT</button>
                        <label class="sprite-upload-label">
                            UPLOAD
                            <input type="file" class="sprite-upload-input" accept=".png,image/png" data-type="${sprite.type}">
                        </label>
                        ${downloadHtml}
                    </div>
                `;

                const editBtn = card.querySelector('.sprite-edit-btn');
                editBtn.addEventListener('click', () => {
                    if (window.PixelEditor) {
                        window.PixelEditor.open(sprite.type, { onSave: loadSprites });
                    } else {
                        toast('Pixel editor not loaded', true);
                    }
                });

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
    async function saveConfig(body, silent) {
        try {
            const res = await fetch('/api/admin/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.ok) {
                if (!silent) toast('Settings saved');
                return true;
            } else {
                const data = await res.json();
                toast(data.error || 'Save failed', true);
                return false;
            }
        } catch (e) {
            toast('Connection error', true);
            return false;
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
