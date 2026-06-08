// ADS-Bit First-Run Setup Wizard
const wizard = {
    currentStep: 0,
    totalSteps: 6,

    init() {
        this.updateProgress();
        this.loadThemes();
    },

    show(step) {
        document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
        const el = document.getElementById('step-' + step);
        if (el) el.classList.add('active');
        this.currentStep = step;
        this.updateProgress();

        if (step === 5) this.buildSummary();
    },

    next() {
        if (this.currentStep < this.totalSteps - 1) {
            this.show(this.currentStep + 1);
        }
    },

    prev() {
        if (this.currentStep > 0) {
            this.show(this.currentStep - 1);
        }
    },

    updateProgress() {
        const pct = (this.currentStep / (this.totalSteps - 1)) * 100;
        document.getElementById('progress-fill').style.width = pct + '%';

        document.querySelectorAll('.step-dot').forEach(dot => {
            const s = parseInt(dot.dataset.step);
            dot.classList.remove('active', 'done');
            if (s === this.currentStep) dot.classList.add('active');
            else if (s < this.currentStep) dot.classList.add('done');
        });
    },

    // Step 1: Password
    async savePassword() {
        const pw = document.getElementById('setup-password').value;
        const confirm = document.getElementById('setup-password-confirm').value;
        const errEl = document.getElementById('password-error');
        errEl.classList.add('hidden');

        if (pw.length < 4) {
            errEl.textContent = 'Password must be at least 4 characters';
            errEl.classList.remove('hidden');
            return;
        }
        if (pw !== confirm) {
            errEl.textContent = 'Passwords do not match';
            errEl.classList.remove('hidden');
            return;
        }

        try {
            const res = await fetch('/api/setup/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: pw })
            });
            if (res.ok) {
                this.next();
            } else {
                const data = await res.json();
                errEl.textContent = data.error || 'Failed to set password';
                errEl.classList.remove('hidden');
            }
        } catch (e) {
            errEl.textContent = 'Connection error';
            errEl.classList.remove('hidden');
        }
    },

    // Step 2: Location
    detectLocation() {
        const statusEl = document.getElementById('location-status');
        if (!navigator.geolocation) {
            statusEl.textContent = 'Geolocation not supported by your browser';
            statusEl.className = 'status-msg error';
            statusEl.classList.remove('hidden');
            return;
        }

        statusEl.textContent = 'Detecting location...';
        statusEl.className = 'status-msg info';
        statusEl.classList.remove('hidden');

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                document.getElementById('setup-lat').value = pos.coords.latitude.toFixed(4);
                document.getElementById('setup-lon').value = pos.coords.longitude.toFixed(4);
                statusEl.textContent = 'Location detected! You can edit the values if needed.';
                statusEl.className = 'status-msg success';
            },
            (err) => {
                statusEl.textContent = 'Could not detect location. Please enter manually.';
                statusEl.className = 'status-msg error';
            }
        );
    },

    async saveLocation() {
        const name = document.getElementById('setup-location-name').value || 'My Location';
        const lat = parseFloat(document.getElementById('setup-lat').value) || 0;
        const lon = parseFloat(document.getElementById('setup-lon').value) || 0;

        try {
            const res = await fetch('/api/setup/location', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, lat, lon })
            });
            if (res.ok) this.next();
        } catch (e) { /* proceed anyway */ this.next(); }
    },

    // Step 3: Receivers
    toggleReceiverMode() {
        const mode = document.getElementById('setup-receiver-mode').value;
        document.getElementById('setup-manual-group').classList.toggle('hidden', mode === 'AUTO');
    },

    async scanReceivers() {
        const btn = document.getElementById('scan-btn');
        const statusEl = document.getElementById('scan-status');
        btn.textContent = 'SCANNING...';
        btn.disabled = true;
        statusEl.textContent = 'Scanning your network for ADS-B receivers...';
        statusEl.className = 'status-msg info';
        statusEl.classList.remove('hidden');

        try {
            const res = await fetch('/api/setup/scan');
            const data = await res.json();
            if (data.receivers && data.receivers.length) {
                statusEl.textContent = `Found ${data.receivers.length} receiver(s): ${data.receivers.join(', ')}`;
                statusEl.className = 'status-msg success';
            } else {
                statusEl.textContent = 'No receivers found. You can add them manually or try again later.';
                statusEl.className = 'status-msg info';
            }
        } catch (e) {
            statusEl.textContent = 'Scan failed. Check your network connection.';
            statusEl.className = 'status-msg error';
        }

        btn.textContent = 'SCAN FOR RECEIVERS';
        btn.disabled = false;
    },

    async saveReceivers() {
        const mode = document.getElementById('setup-receiver-mode').value;
        const port = parseInt(document.getElementById('setup-receiver-port').value) || 30003;
        const body = { mode, port };

        if (mode === 'MANUAL') {
            const ips = document.getElementById('setup-receiver-ips').value
                .split('\n').map(s => s.trim()).filter(Boolean);
            body.ips = ips;
        }

        try {
            await fetch('/api/setup/receivers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch (e) { /* proceed */ }
        this.next();
    },

    // Step 4: Theme
    async loadThemes() {
        try {
            const res = await fetch('/api/admin/themes');
            if (!res.ok) {
                // Not authenticated yet, try fetching available backgrounds
                this.addDefaultThemes();
                return;
            }
            const data = await res.json();
            const sel = document.getElementById('setup-theme');
            sel.innerHTML = '';
            (data.themes || ['desert']).forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
                sel.appendChild(opt);
            });
        } catch (e) {
            this.addDefaultThemes();
        }
    },

    addDefaultThemes() {
        const sel = document.getElementById('setup-theme');
        sel.innerHTML = '';
        ['desert', 'custom'].forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
            sel.appendChild(opt);
        });
    },

    async saveTheme() {
        const theme = document.getElementById('setup-theme').value;
        const tempUnit = document.getElementById('setup-temp-unit').value;
        const siteTitle = document.getElementById('setup-site-title').value || 'ADS-Bit';

        try {
            await fetch('/api/setup/theme', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    theme,
                    temperature_unit: tempUnit,
                    site_title: siteTitle
                })
            });
        } catch (e) { /* proceed */ }
        this.next();
    },

    // Step 5: Summary & Complete
    buildSummary() {
        const container = document.getElementById('setup-summary');
        const rows = [
            { label: 'LOCATION', value: document.getElementById('setup-location-name').value || 'My Location' },
            { label: 'COORDINATES', value: `${document.getElementById('setup-lat').value || '0'}, ${document.getElementById('setup-lon').value || '0'}` },
            { label: 'RECEIVERS', value: document.getElementById('setup-receiver-mode').value },
            { label: 'THEME', value: document.getElementById('setup-theme').value || 'desert' },
            { label: 'TEMP UNIT', value: document.getElementById('setup-temp-unit').value || 'F' },
            { label: 'PASSWORD', value: 'Set' }
        ];

        container.innerHTML = rows.map(r =>
            `<div class="summary-row"><span class="summary-label">${r.label}</span><span class="summary-value">${r.value}</span></div>`
        ).join('');
    },

    async finish() {
        try {
            const res = await fetch('/api/setup/complete', { method: 'POST' });
            if (res.ok) {
                window.location.href = '/';
            } else {
                const data = await res.json();
                alert(data.error || 'Setup could not be completed');
            }
        } catch (e) {
            alert('Connection error');
        }
    }
};

wizard.init();
