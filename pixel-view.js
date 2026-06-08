// Pixel ADS-B - Retro Side View
class PixelADSB {
    constructor() {
        this.canvas = document.getElementById('pixel-canvas');
        this.ctx = this.canvas.getContext('2d');

        // Set up responsive canvas sizing
        this.setupResponsiveCanvas();

        this.width = this.canvas.width;
        this.height = this.canvas.height;

        // Receiver location (will be fetched from config API)
        this.receiverLat = 0;
        this.receiverLon = 0;
        this.locationName = 'Loading...';
        this.receivers = [];

        // Flight data
        this.flights = new Map();
        this.aircraftTypes = new Map(); // Cache ICAO -> aircraft type

        // WebSocket
        this.ws = null;
        this.reconnectDelay = 1000;

        // Colors (retro pixel art theme)
        this.colors = {
            skyTop: '#6ca4dc',
            skyBottom: '#b4d4ec',
            cloud: '#ffffff',
            sun: '#fcd444',
            ground: '#d4a868',
            groundDark: '#b8884c',
            dirt: '#a87840',
            antenna: '#c0c0c0',      // Silver/gray antenna
            antennaDark: '#808080',  // Dark gray for shading
            antennaBase: '#4c4c4c',  // Dark base
            antennaRing: '#ffffff',  // White rings
            plane: '#fcfcfc',
            planeTowards: '#54fc54',
            planeAway: '#fc9c54',
            text: '#fcfcfc',
            textShadow: '#000000',
            grid: 'rgba(255, 255, 255, 0.1)',
            cactus: '#54a844',
            cactusDark: '#3c7c30',
            mountain: '#8c7c68',
            mountainSnow: '#fcfcfc',
            rain: 'rgba(120, 160, 200, 0.5)',
            snow: '#fcfcfc'
        };

        // Weather state
        this.weather = {
            condition: 'clear', // clear, cloudy, rain, snow
            description: 'Clear',
            temp: 0,
            sunrise: null,
            sunset: null,
            lastUpdate: 0
        };

        // View direction state (0=North, 90=East, 180=South, 270=West)
        this.viewDirection = 0;
        this.viewDirectionNames = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
        this.fieldOfView = 90; // 90 degree field of view

        // Theme for background images (loaded from config)
        this.theme = 'desert';

        // Display preferences (loaded from config)
        this.displayConfig = {
            temperature_unit: 'F',
            show_weather: true,
            show_sidebar: true,
            default_view_direction: 0
        };
        this.siteConfig = {
            title: 'ADS-Bit',
            subtitle: 'Retro Flight Tracker'
        };

        // Hover and selection tracking
        this.mouseX = -1;
        this.mouseY = -1;
        this.hoveredAircraft = null;
        this.selectedAircraftIcao = null; // Selected from sidebar click
        this.visibleAircraftList = []; // For sidebar display
        this.lastSidebarUpdate = 0; // Throttle sidebar updates
        this.lastStatsUpdate = 0; // Throttle stats updates
        this.cachedCountText = '';
        this.cachedRangeText = '';

        // Load aircraft sprite images
        this.aircraftImages = {
            smallProp: new Image(),
            regionalJet: new Image(),
            narrowBody: new Image(),
            wideBody: new Image(),
            heavy: new Image(),
            helicopter: new Image()
        };

        // Track which images have loaded
        this.aircraftImagesLoaded = {
            smallProp: false,
            regionalJet: false,
            narrowBody: false,
            wideBody: false,
            heavy: false,
            helicopter: false
        };

        // Load all aircraft images
        Object.keys(this.aircraftImages).forEach(type => {
            this.aircraftImages[type].onload = () => {
                this.aircraftImagesLoaded[type] = true;
                console.log(`${type} sprite loaded`);
            };
            this.aircraftImages[type].onerror = () => {
                console.warn(`Failed to load ${type} sprite`);
            };
            this.aircraftImages[type].src = `images/${type}.png?v=24`;
        });

        // Load environment images (directional backgrounds, base, sun, clouds)
        // Directional background images (loaded after fetching config)
        this.backgroundImages = {
            0: new Image(),    // North
            90: new Image(),   // East
            180: new Image(),  // South
            270: new Image()   // West
        };
        this.backgroundImagesLoaded = { 0: false, 90: false, 180: false, 270: false };

        this.sunImage = new Image();
        this.sunImage.onload = () => {
            this.sunImageLoaded = true;
            console.log('sun.png loaded');
        };
        this.sunImage.onerror = () => {
            console.warn('Failed to load sun.png');
        };
        this.sunImage.src = 'images/sun.png?v=24';

        this.happyCloudImage = new Image();
        this.happyCloudImage.onload = () => {
            this.happyCloudImageLoaded = true;
            console.log('happycloud.png loaded');
        };
        this.happyCloudImage.onerror = () => {
            console.warn('Failed to load happycloud.png');
        };
        this.happyCloudImage.src = 'images/happycloud.png?v=24';

        this.rainCloudImage = new Image();
        this.rainCloudImage.onload = () => {
            this.rainCloudImageLoaded = true;
            console.log('raincloud.png loaded');
        };
        this.rainCloudImage.onerror = () => {
            console.warn('Failed to load raincloud.png');
        };
        this.rainCloudImage.src = 'images/raincloud.png?v=24';

        this.moonSprite = new Image();
        this.moonSprite.onload = () => {
            this.moonSpriteLoaded = true;
            console.log('moon_6_phases.png loaded');
        };
        this.moonSprite.onerror = () => {
            console.warn('Failed to load moon_6_phases.png');
        };
        this.moonSprite.src = 'images/moon_6_phases.png?v=32';

        // Track which environment images have loaded
        this.sunImageLoaded = false;
        this.happyCloudImageLoaded = false;
        this.rainCloudImageLoaded = false;
        this.moonSpriteLoaded = false;

        // Pixel art sprites (kept as fallback and for other elements)
        this.sprites = this.createSprites();

        this.init();
    }

    createSprites() {
        // Define pixel art sprites as 2D arrays (1 = mast, 2 = white ring, 3 = base)
        return {
            // ADS-B Antenna
            antenna: [
                [0,0,1,0,0],     // Top tip
                [0,1,2,1,0],     // Top ring (white)
                [0,0,1,0,0],     // Mast
                [0,0,1,0,0],     // Mast
                [0,1,2,1,0],     // Ring
                [0,0,1,0,0],     // Mast
                [0,0,1,0,0],     // Mast
                [1,1,2,1,1],     // Large ring
                [0,0,1,0,0],     // Mast
                [0,0,1,0,0],     // Mast
                [0,3,3,3,0],     // Base
                [3,3,3,3,3]      // Base platform
            ],
            // Cactus (saguaro style)
            cactus: [
                [0,1,0,0,0,1,0],
                [0,1,0,0,0,1,0],
                [1,1,1,1,1,1,1],
                [0,0,1,1,1,0,0],
                [0,0,1,1,1,0,0],
                [0,0,1,1,1,0,0],
                [0,0,1,1,1,0,0],
                [0,0,1,1,1,0,0]
            ],
            // Mountain (simple peak)
            mountain: [
                [0,0,0,0,0,1,0,0,0,0,0],
                [0,0,0,0,1,1,1,0,0,0,0],
                [0,0,0,1,1,2,1,1,0,0,0],
                [0,0,1,1,1,2,1,1,1,0,0],
                [0,1,1,1,1,1,1,1,1,1,0],
                [1,1,1,1,1,1,1,1,1,1,1]
            ],
            // Aircraft sprites (side view, facing right)
            // Colors: 1=fuselage, 2=windows, 3=wings, 4=tail, 5=engine

            // Small prop plane (Cessna, small GA)
            smallProp: [
                [0,0,0,0,4,4,0,0],      // Tail
                [0,0,0,4,4,1,4,0],      // Tail fin
                [0,0,0,1,1,1,1,0],      // Rear fuselage
                [0,0,1,2,1,1,1,1],      // Fuselage with windows
                [3,3,3,3,3,1,1,1],      // Wings + nose
                [0,0,1,2,1,1,5,1],      // Fuselage with prop
                [0,0,0,1,1,1,1,0],      // Belly
                [0,0,0,0,0,3,0,0]       // Bottom wing
            ],

            // Regional jet (CRJ, ERJ)
            regionalJet: [
                [0,0,0,0,0,4,4,0,0],    // Tail
                [0,0,0,0,4,4,1,4,0],    // Tail fin
                [0,0,0,0,1,1,1,1,0],    // Rear fuselage
                [0,0,0,1,2,2,1,1,1],    // Fuselage with windows
                [0,3,3,3,3,3,3,1,1],    // Wings
                [0,0,0,1,2,2,1,5,1],    // Fuselage + engine
                [0,0,0,0,1,1,1,5,1],    // Belly + engine
                [0,0,0,0,0,0,3,0,0]     // Wing tip
            ],

            // Narrow body (737, A320)
            narrowBody: [
                [0,0,0,0,0,4,4,4,0,0],      // Tall tail
                [0,0,0,0,4,4,1,1,4,0],      // Tail fin
                [0,0,0,0,1,1,1,1,1,0],      // Rear fuselage
                [0,0,0,1,2,2,2,1,1,1],      // Windows
                [0,0,3,3,3,3,3,3,1,1],      // Wings
                [0,0,0,1,2,2,2,1,5,5],      // Lower fuselage + engines
                [0,0,0,0,1,1,1,1,5,5],      // Belly + engines
                [0,0,0,0,0,0,3,3,0,0]       // Wing tip
            ],

            // Wide body (777, 787, A350)
            wideBody: [
                [0,0,0,0,0,0,4,4,4,0,0],    // Tall tail
                [0,0,0,0,0,4,4,1,1,4,0],    // Tail fin
                [0,0,0,0,0,1,1,1,1,1,0],    // Rear fuselage
                [0,0,0,0,1,2,2,2,1,1,1],    // Upper windows
                [0,0,0,3,3,3,3,3,3,1,1],    // Large wings
                [0,0,0,3,3,3,3,3,3,1,1],    // Wing body
                [0,0,0,0,1,2,2,2,5,5,5],    // Lower fuselage + big engines
                [0,0,0,0,0,1,1,1,5,5,5],    // Belly + engines
                [0,0,0,0,0,0,0,3,3,0,0]     // Wing tip
            ],

            // Heavy/jumbo (747, A380)
            heavy: [
                [0,0,0,0,0,0,4,4,4,4,0,0],  // Very tall tail
                [0,0,0,0,0,4,4,1,1,1,4,0],  // Tail fin
                [0,0,0,0,2,2,1,1,1,1,1,0],  // Upper deck with windows!
                [0,0,0,0,1,1,1,1,1,1,1,0],  // Upper fuselage
                [0,0,0,1,2,2,2,2,1,1,1,1],  // Main deck windows
                [0,0,3,3,3,3,3,3,3,1,1,1],  // Massive wings
                [0,0,3,3,3,3,3,3,3,1,1,1],  // Wing body
                [0,0,0,1,2,2,2,2,5,5,5,5],  // Lower deck + huge engines
                [0,0,0,0,1,1,1,1,5,5,5,5],  // Belly + engines
                [0,0,0,0,0,0,0,3,3,3,0,0]   // Wing tips
            ]
        };
    }

    processPlaneImage() {
        // Create an off-screen canvas to process the image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.planeImage.width;
        tempCanvas.height = this.planeImage.height;
        const tempCtx = tempCanvas.getContext('2d');

        // Draw the original image
        tempCtx.drawImage(this.planeImage, 0, 0);

        // Get image data
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const data = imageData.data;
        const width = tempCanvas.width;
        const height = tempCanvas.height;

        // Flood fill from corners to mark background pixels
        const isBackground = new Uint8Array(width * height);

        const isWhiteish = (r, g, b) => r > 240 && g > 240 && b > 240;

        const floodFill = (startX, startY) => {
            const stack = [[startX, startY]];

            while (stack.length > 0) {
                const [x, y] = stack.pop();

                if (x < 0 || x >= width || y < 0 || y >= height) continue;

                const idx = y * width + x;
                if (isBackground[idx]) continue;

                const pixelIdx = idx * 4;
                const r = data[pixelIdx];
                const g = data[pixelIdx + 1];
                const b = data[pixelIdx + 2];

                if (!isWhiteish(r, g, b)) continue;

                isBackground[idx] = 1;

                // Add neighbors
                stack.push([x + 1, y]);
                stack.push([x - 1, y]);
                stack.push([x, y + 1]);
                stack.push([x, y - 1]);
            }
        };

        // Flood fill from all four corners
        floodFill(0, 0);
        floodFill(width - 1, 0);
        floodFill(0, height - 1);
        floodFill(width - 1, height - 1);

        // Make background pixels transparent
        for (let i = 0; i < isBackground.length; i++) {
            if (isBackground[i]) {
                data[i * 4 + 3] = 0; // Set alpha to 0
            }
        }

        // Put the modified data back
        tempCtx.putImageData(imageData, 0, 0);

        // Create a new image from the processed canvas
        this.processedPlaneImage = new Image();
        this.processedPlaneImage.src = tempCanvas.toDataURL();
        this.processedPlaneImage.onload = () => {
            this.planeImageLoaded = true;
            console.log('Plane image processed and loaded');
        };
    }

    setupResponsiveCanvas() {
        const resizeCanvas = () => {
            const container = this.canvas.parentElement;
            const containerWidth = container.clientWidth;
            const containerHeight = container.clientHeight;

            // Maintain 4:3 aspect ratio (800x600)
            const aspectRatio = 4 / 3;
            let newWidth, newHeight;

            if (containerWidth / containerHeight > aspectRatio) {
                // Container is wider - fit to height
                newHeight = containerHeight;
                newWidth = newHeight * aspectRatio;
            } else {
                // Container is taller - fit to width
                newWidth = containerWidth;
                newHeight = newWidth / aspectRatio;
            }

            // Set canvas internal resolution (1200x900 for larger display)
            this.canvas.width = 1200;
            this.canvas.height = 900;

            // Update stored dimensions
            this.width = 1200;
            this.height = 900;

            // CSS will handle the visual scaling via CSS in HTML
        };

        // Initial resize
        resizeCanvas();

        // Handle window resize and orientation change
        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('orientationchange', () => {
            setTimeout(resizeCanvas, 100);
        });
    }

    async init() {
        // Fetch config (includes theme and location)
        await this.fetchConfig();

        // Load background images based on theme
        this.loadBackgroundImages();

        // Fetch weather
        await this.fetchWeather();

        // Update weather every 10 minutes
        setInterval(() => this.fetchWeather(), 600000);

        // Update date/time display every second
        setInterval(() => this.updateWeatherDisplay(), 1000);

        // Setup view direction controls
        this.setupViewControls();

        // Start rendering loop
        this.render();
        setInterval(() => this.render(), 100); // 10 FPS for retro feel

        // Connect to WebSocket
        this.connectWebSocket();
    }

    setupViewControls() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                this.rotateView(-90);
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                this.rotateView(90);
            }
        });

        // Click handlers for arrow buttons
        const leftArrow = document.getElementById('view-left');
        const rightArrow = document.getElementById('view-right');

        if (leftArrow) {
            leftArrow.addEventListener('click', () => this.rotateView(-90));
        }
        if (rightArrow) {
            rightArrow.addEventListener('click', () => this.rotateView(90));
        }

        // Mouse tracking for hover labels
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            // Convert mouse position to canvas coordinates
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            this.mouseX = (e.clientX - rect.left) * scaleX;
            this.mouseY = (e.clientY - rect.top) * scaleY;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.mouseX = -1;
            this.mouseY = -1;
            this.hoveredAircraft = null;
        });

        // Click on canvas to deselect
        this.canvas.addEventListener('click', () => {
            this.selectedAircraftIcao = null;
            this.updateAircraftSidebar();
        });

        // Sidebar click handler (delegated)
        const sidebar = document.getElementById('aircraft-sidebar');
        if (sidebar) {
            sidebar.addEventListener('click', (e) => {
                const aircraftEl = e.target.closest('.sidebar-aircraft');
                if (aircraftEl) {
                    const icao = aircraftEl.dataset.icao;
                    // Toggle selection
                    if (this.selectedAircraftIcao === icao) {
                        this.selectedAircraftIcao = null;
                    } else {
                        this.selectedAircraftIcao = icao;
                    }
                    this.updateAircraftSidebar();
                }
            });
        }

        // Update initial compass display
        this.updateCompassDisplay();
    }

    rotateView(degrees) {
        this.viewDirection = (this.viewDirection + degrees + 360) % 360;
        this.updateCompassDisplay();
        console.log(`View direction: ${this.viewDirectionNames[this.viewDirection]} (${this.viewDirection}°)`);
    }

    updateCompassDisplay() {
        const compassEl = document.getElementById('compass-direction');
        if (compassEl) {
            const dirName = this.viewDirectionNames[this.viewDirection];
            const fullNames = { 'N': 'NORTH', 'E': 'EAST', 'S': 'SOUTH', 'W': 'WEST' };
            compassEl.textContent = `VIEWING: ${fullNames[dirName]}`;
        }
    }

    // Check if a bearing falls within the current field of view
    isInFieldOfView(bearing) {
        const halfFov = this.fieldOfView / 2;
        const minAngle = (this.viewDirection - halfFov + 360) % 360;
        const maxAngle = (this.viewDirection + halfFov) % 360;

        // Handle wrap-around at 0/360
        if (minAngle > maxAngle) {
            return bearing >= minAngle || bearing <= maxAngle;
        } else {
            return bearing >= minAngle && bearing <= maxAngle;
        }
    }

    // Get X position based on bearing within field of view
    bearingToX(bearing) {
        const halfFov = this.fieldOfView / 2;

        // Calculate angle difference from view direction
        let angleDiff = bearing - this.viewDirection;

        // Normalize to -180 to 180
        if (angleDiff > 180) angleDiff -= 360;
        if (angleDiff < -180) angleDiff += 360;

        // Map -45 to +45 degrees to screen X (with padding)
        const padding = 60;
        const usableWidth = this.width - (padding * 2);

        // -45° = left edge, +45° = right edge
        const normalizedAngle = (angleDiff + halfFov) / this.fieldOfView;
        return padding + (normalizedAngle * usableWidth);
    }

    async fetchConfig() {
        try {
            const response = await fetch('/api/config');
            const data = await response.json();
            this.theme = data.theme || 'desert';
            this.receiverLat = data.location?.lat || 0;
            this.receiverLon = data.location?.lon || 0;
            this.locationName = data.location?.name || 'My Location';
            this.receivers = data.receivers || [];

            // Apply site config
            if (data.site) {
                this.siteConfig = { ...this.siteConfig, ...data.site };
                const titleEl = document.getElementById('site-title');
                if (titleEl) titleEl.textContent = this.siteConfig.title;
                document.title = `${this.siteConfig.title} - ${this.siteConfig.subtitle}`;
            }

            // Apply display config
            if (data.display) {
                this.displayConfig = { ...this.displayConfig, ...data.display };

                // Apply default view direction
                if (this.displayConfig.default_view_direction) {
                    this.viewDirection = this.displayConfig.default_view_direction;
                }

                // Show/hide sidebar
                const sidebar = document.getElementById('aircraft-sidebar');
                if (sidebar) {
                    sidebar.style.display = this.displayConfig.show_sidebar ? '' : 'none';
                }

                // Show/hide weather bar
                const weatherBar = document.getElementById('weather-info');
                if (weatherBar) {
                    weatherBar.style.display = this.displayConfig.show_weather ? '' : 'none';
                }
            }

            console.log(`Config loaded - Theme: ${this.theme}, Location: ${this.locationName} (${this.receiverLat}, ${this.receiverLon})`);
            console.log(`Receivers: ${this.receivers.join(', ') || 'none'}`);
        } catch (error) {
            console.warn('Could not fetch config, using defaults');
            // Fallback to receiver-location API for backwards compatibility
            await this.fetchReceiverLocation();
        }
    }

    loadBackgroundImages() {
        const directions = [
            { deg: 0, name: 'north' },
            { deg: 90, name: 'east' },
            { deg: 180, name: 'south' },
            { deg: 270, name: 'west' }
        ];
        directions.forEach(dir => {
            this.backgroundImages[dir.deg].onload = () => {
                this.backgroundImagesLoaded[dir.deg] = true;
                console.log(`${this.theme}/${dir.name}.png loaded`);
            };
            this.backgroundImages[dir.deg].onerror = () => {
                console.warn(`Failed to load backgrounds/${this.theme}/${dir.name}.png`);
            };
            this.backgroundImages[dir.deg].src = `backgrounds/${this.theme}/${dir.name}.png?v=1`;
        });
    }

    async fetchReceiverLocation() {
        try {
            // Fetch from same server that serves pixel-view
            const response = await fetch('/api/receiver-location');
            const data = await response.json();
            this.receiverLat = data.lat;
            this.receiverLon = data.lon;
            this.locationName = data.name || 'My Location';
            console.log(`Receiver location: ${this.locationName} (${this.receiverLat}, ${this.receiverLon})`);
        } catch (error) {
            console.warn('Could not fetch receiver location, using default');
        }
    }

    async fetchWeather() {
        try {
            // Use Open-Meteo API (free, no API key needed) with daily forecast for sunrise/sunset
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${this.receiverLat}&longitude=${this.receiverLon}&current_weather=true&daily=sunrise,sunset&timezone=auto`;
            const response = await fetch(url);
            const data = await response.json();

            const weatherCode = data.current_weather.weathercode;
            this.weather.temp = data.current_weather.temperature;

            // Get today's sunrise and sunset times
            if (data.daily && data.daily.sunrise && data.daily.sunset) {
                this.weather.sunrise = new Date(data.daily.sunrise[0]);
                this.weather.sunset = new Date(data.daily.sunset[0]);
            }

            // Map weather codes to conditions
            // 0 = clear, 1-3 = partly cloudy, 45-48 = fog, 51-67 = rain, 71-77 = snow, 80-99 = rain/thunderstorm
            if (weatherCode === 0) {
                this.weather.condition = 'clear';
                this.weather.description = 'Clear';
            } else if (weatherCode <= 3) {
                this.weather.condition = 'cloudy';
                this.weather.description = 'Partly Cloudy';
            } else if ((weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 99)) {
                this.weather.condition = 'rain';
                this.weather.description = 'Rainy';
            } else if (weatherCode >= 71 && weatherCode <= 77) {
                this.weather.condition = 'snow';
                this.weather.description = 'Snowy';
            } else {
                this.weather.condition = 'cloudy';
                this.weather.description = 'Cloudy';
            }

            this.weather.lastUpdate = Date.now();
            this.updateWeatherDisplay();
            console.log(`Weather updated: ${this.weather.condition}, ${this.weather.temp}°C`);
        } catch (error) {
            console.warn('Could not fetch weather data', error);
            this.weather.condition = 'clear'; // Default to clear
        }
    }

    updateWeatherDisplay() {
        // Update date/time display
        const now = new Date();
        const options = {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        };
        const dateTimeStr = now.toLocaleString('en-US', options);
        document.getElementById('datetime-display').textContent = `${this.locationName} - ${dateTimeStr}`;

        // Update weather display with configured unit
        let tempDisplay;
        if (this.displayConfig.temperature_unit === 'C') {
            tempDisplay = `${Math.round(this.weather.temp)}°C`;
        } else {
            tempDisplay = `${Math.round((this.weather.temp * 9/5) + 32)}°F`;
        }
        document.getElementById('weather-display').textContent = `${tempDisplay} - ${this.weather.description}`;

        // Update sunrise/sunset times
        if (this.weather.sunrise && this.weather.sunset) {
            const sunriseStr = this.weather.sunrise.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            const sunsetStr = this.weather.sunset.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            document.getElementById('sun-times').textContent = `☀ ${sunriseStr} / 🌙 ${sunsetStr}`;
        }
    }

    connectWebSocket() {
        // Dynamically build WebSocket URL based on current page
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}/ws`;

        console.log(`Connecting to WebSocket: ${wsUrl}`);
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connected');
            const receiverText = this.receivers && this.receivers.length > 0
                ? `CONNECTED: ${this.receivers.join(', ')}`
                : 'CONNECTED';
            document.getElementById('connection-status').textContent = receiverText;
            document.getElementById('connection-status').classList.remove('blink');
            this.reconnectDelay = 1000;
        };

        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'flights') {
                this.updateFlights(data.flights);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting...');
            document.getElementById('connection-status').textContent = 'RECONNECTING...';
            document.getElementById('connection-status').classList.add('blink');
            setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    }

    updateFlights(flights) {
        this.flights.clear();
        flights.forEach(flight => {
            if (flight.lat && flight.lon && flight.altitude) {
                this.flights.set(flight.icao, flight);
                // Categorize aircraft type if not already done
                if (!this.aircraftTypes.has(flight.icao)) {
                    this.categorizeAircraft(flight);
                }
            }
        });
        // Aircraft count is now updated in drawAircraft() with visible/total format
    }

    categorizeAircraft(flight) {
        // Categorize aircraft based on available data
        // Priority: 1. Helicopter detection, 2. Callsign patterns, 3. Altitude/Speed heuristics

        let category = 'narrowBody'; // Default

        const callsign = (flight.callsign || '').trim();
        const altitude = flight.altitude || 0;
        const speed = flight.speed || 0;

        // Helicopter detection with multiple criteria
        // Known helicopter callsign patterns (medical, news, police, tours, etc.)
        const helicopterCallsigns = ['LIFE', 'MED', 'STAR', 'AIR', 'CARE', 'MERCY', 'REACH', 'CHP', 'COPTER', 'HELO', 'N', 'PHI'];
        const isHelicopterCallsign = helicopterCallsigns.some(pattern =>
            callsign.includes(pattern) || callsign.startsWith('N') && callsign.length <= 6
        );

        // Helicopter speed/altitude heuristics:
        // - Very low speed at any altitude (< 100 knots)
        // - Low altitude with moderate speed (< 3000 ft and < 180 knots)
        // - Known helicopter callsign with reasonable parameters (< 10000 ft and < 200 knots)
        if (isHelicopterCallsign && altitude < 10000 && speed < 200) {
            category = 'helicopter';
        } else if (speed < 100 && altitude < 15000) {
            category = 'helicopter';
        } else if (altitude < 3000 && speed < 180) {
            category = 'helicopter';
        }
        // Heavy/jumbo aircraft callsigns (cargo and passenger)
        else if (callsign.length > 0) {
            const heavyCallsigns = ['CPA', 'UAE', 'ETH', 'QTR', 'SIA', 'KLM', 'AFL', 'BAW', 'AAL', 'DAL', 'UAL', 'FDX', 'UPS'];
            // Regional jet callsigns
            const regionalCallsigns = ['SKW', 'RPA', 'ASH', 'PDT', 'CHQ', 'ENY'];
            // Small prop patterns (typically GA aircraft with N-numbers or short callsigns)
            const isSmallProp = callsign.length <= 4 && (callsign.startsWith('N') || !callsign.match(/[0-9]/));

            // Check callsign patterns
            const airline = callsign.substring(0, 3);
            if (heavyCallsigns.includes(airline) || altitude > 40000 || speed > 500) {
                // High altitude or speed suggests wide body or heavy
                if (altitude > 42000 || speed > 550) {
                    category = 'heavy';
                } else {
                    category = 'wideBody';
                }
            } else if (regionalCallsigns.includes(airline) || (altitude < 25000 && speed < 350)) {
                category = 'regionalJet';
            } else if (isSmallProp || (altitude < 10000 && speed < 200)) {
                category = 'smallProp';
            } else {
                // Default narrow body (737, A320 family)
                category = 'narrowBody';
            }
        }

        this.aircraftTypes.set(flight.icao, category);
    }

    getAircraftSprite(icao) {
        const category = this.aircraftTypes.get(icao) || 'narrowBody';
        return this.sprites[category] || this.sprites.narrowBody;
    }

    // Calculate distance in nautical miles
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 3440.065; // Earth radius in nautical miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    // Calculate bearing from receiver to aircraft
    calculateBearing(lat1, lon1, lat2, lon2) {
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
        const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
                  Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
        const bearing = Math.atan2(y, x) * 180 / Math.PI;
        return (bearing + 360) % 360;
    }

    // Check if plane is flying towards or away from receiver
    isFlyingTowards(flight) {
        const bearingToReceiver = this.calculateBearing(
            flight.lat, flight.lon,
            this.receiverLat, this.receiverLon
        );
        const headingDiff = Math.abs(flight.track - bearingToReceiver);
        const normalizedDiff = headingDiff > 180 ? 360 - headingDiff : headingDiff;
        return normalizedDiff < 90; // Less than 90 degrees = flying towards
    }

    render() {
        // Draw sky gradient
        this.drawSky();

        // Draw clouds
        this.drawClouds();

        // Draw sun
        this.drawSun();

        // Draw moon
        this.drawMoon();

        // Weather is represented by cloud sprites (rain clouds vs happy clouds)
        // No additional weather effects needed

        // Draw ground (directional background) - after celestial bodies so horizon covers low sun/moon
        this.drawGround();

        // Draw grid lines for altitude reference
        this.drawGrid();

        // Calculate auto-scaling
        const scale = this.calculateScale();

        // Draw aircraft on top of everything
        this.drawAircraft(scale);

        // Draw scale indicators
        this.drawScaleIndicators(scale);

        // Draw compass indicators
        this.drawCompassIndicators();
    }

    getSkyColors() {
        // Calculate sun position to determine sky colors
        const now = new Date();

        if (!this.weather.sunrise || !this.weather.sunset) {
            // Default day colors if no sun data
            return { top: this.colors.skyTop, bottom: this.colors.skyBottom };
        }

        const sunrise = this.weather.sunrise.getTime();
        const sunset = this.weather.sunset.getTime();
        const current = now.getTime();

        // Dawn/Dusk transition period (30 minutes)
        const transitionTime = 30 * 60 * 1000;

        // Dawn colors (orange/pink sunrise)
        const dawnTop = '#4c5c8c';
        const dawnBottom = '#dc8c5c';

        // Day colors (bright blue)
        const dayTop = '#6ca4dc';
        const dayBottom = '#b4d4ec';

        // Dusk colors (orange/purple sunset)
        const duskTop = '#6c5c9c';
        const duskBottom = '#dc9c6c';

        // Night colors (dark blue/purple)
        const nightTop = '#1c2c4c';
        const nightBottom = '#2c3c5c';

        // Determine time of day and interpolate colors
        if (current < sunrise - transitionTime) {
            // Night (before dawn)
            return { top: nightTop, bottom: nightBottom };
        } else if (current < sunrise) {
            // Dawn transition
            const progress = (current - (sunrise - transitionTime)) / transitionTime;
            return {
                top: this.interpolateColor(nightTop, dawnTop, progress),
                bottom: this.interpolateColor(nightBottom, dawnBottom, progress)
            };
        } else if (current < sunrise + transitionTime) {
            // Sunrise to day transition
            const progress = (current - sunrise) / transitionTime;
            return {
                top: this.interpolateColor(dawnTop, dayTop, progress),
                bottom: this.interpolateColor(dawnBottom, dayBottom, progress)
            };
        } else if (current < sunset - transitionTime) {
            // Full day
            return { top: dayTop, bottom: dayBottom };
        } else if (current < sunset) {
            // Day to dusk transition
            const progress = (current - (sunset - transitionTime)) / transitionTime;
            return {
                top: this.interpolateColor(dayTop, duskTop, progress),
                bottom: this.interpolateColor(dayBottom, duskBottom, progress)
            };
        } else if (current < sunset + transitionTime) {
            // Dusk to night transition
            const progress = (current - sunset) / transitionTime;
            return {
                top: this.interpolateColor(duskTop, nightTop, progress),
                bottom: this.interpolateColor(duskBottom, nightBottom, progress)
            };
        } else {
            // Night (after dusk)
            return { top: nightTop, bottom: nightBottom };
        }
    }

    interpolateColor(color1, color2, factor) {
        // Interpolate between two hex colors
        const c1 = parseInt(color1.slice(1), 16);
        const c2 = parseInt(color2.slice(1), 16);

        const r1 = (c1 >> 16) & 0xff;
        const g1 = (c1 >> 8) & 0xff;
        const b1 = c1 & 0xff;

        const r2 = (c2 >> 16) & 0xff;
        const g2 = (c2 >> 8) & 0xff;
        const b2 = c2 & 0xff;

        const r = Math.round(r1 + (r2 - r1) * factor);
        const g = Math.round(g1 + (g2 - g1) * factor);
        const b = Math.round(b1 + (b2 - b1) * factor);

        return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    }

    drawSky() {
        // Sky gradient (SNES style) - adjust based on time of day and weather
        const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height - 60);

        // Get base sky colors based on sun position
        let skyColors = this.getSkyColors();
        let skyTop = skyColors.top;
        let skyBottom = skyColors.bottom;

        // Adjust for weather conditions (darken for rain/snow)
        if (this.weather.condition === 'rain' || this.weather.condition === 'snow') {
            // Darken the sky colors
            skyTop = this.interpolateColor(skyTop, '#4c5c6c', 0.4);
            skyBottom = this.interpolateColor(skyBottom, '#7c8c9c', 0.4);
        } else if (this.weather.condition === 'cloudy') {
            // Slightly darken for cloudy
            skyTop = this.interpolateColor(skyTop, '#5c6c7c', 0.2);
            skyBottom = this.interpolateColor(skyBottom, '#8c9cac', 0.2);
        }

        gradient.addColorStop(0, skyTop);
        gradient.addColorStop(1, skyBottom);
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.width, this.height - 60);
    }

    drawClouds() {
        // Choose cloud image based on weather condition
        const isRainy = (this.weather.condition === 'rain' || this.weather.condition === 'snow');
        const cloudImage = isRainy ? this.rainCloudImage : this.happyCloudImage;
        const cloudImageLoaded = isRainy ? this.rainCloudImageLoaded : this.happyCloudImageLoaded;

        // Use PNG images if loaded, otherwise fall back to programmatic rendering
        if (cloudImageLoaded && cloudImage.complete) {
            // Animate clouds moving across screen
            const time = Date.now() / 10000; // Slow cloud movement
            const numClouds = (this.weather.condition === 'cloudy' || isRainy) ? 8 : 4;

            // Calculate proper width/height maintaining aspect ratio (150% scale)
            const cloudHeight = 90;
            const aspectRatio = cloudImage.width / cloudImage.height;
            const cloudWidth = cloudHeight * aspectRatio;

            // Generate random but consistent offsets for each cloud using seeded positions
            for (let i = 0; i < numClouds; i++) {
                // Use cloud index as seed for consistent random positions
                const seed = i * 123.456;
                const xOffset = Math.sin(seed) * 200; // Random horizontal offset
                const yOffset = Math.cos(seed * 1.5) * 60; // Random vertical offset
                const speed = 15 + (Math.sin(seed * 2) * 5); // Varying cloud speeds

                const x = ((i * 180 + xOffset + time * speed) % (this.width + cloudWidth)) - cloudWidth;
                const y = 20 + yOffset + Math.abs(Math.sin(seed * 3) * 80);

                this.ctx.drawImage(cloudImage, x, y, cloudWidth, cloudHeight);
            }
        } else {
            // Fallback to programmatic cloud rendering
            const time = Date.now() / 10000;
            const pixelSize = 4;
            const numClouds = (this.weather.condition === 'cloudy' || isRainy) ? 10 : 5;

            for (let i = 0; i < numClouds; i++) {
                const x = ((i * 100 + time * 20) % (this.width + 100)) - 50;
                const y = 20 + (i % 5) * 15;

                // Darker clouds for rain/snow
                if (isRainy) {
                    this.ctx.fillStyle = '#c4c4c4';
                } else {
                    this.ctx.fillStyle = this.colors.cloud;
                }

                // Cloud shape (simple)
                this.ctx.fillRect(x, y, pixelSize * 3, pixelSize);
                this.ctx.fillRect(x + pixelSize, y - pixelSize, pixelSize * 2, pixelSize);
                this.ctx.fillRect(x - pixelSize, y, pixelSize * 5, pixelSize);
            }
        }
    }

    calculateSunPosition() {
        // Calculate sun's position in the sky using astronomical formulas
        const now = new Date();

        if (!this.weather.sunrise || !this.weather.sunset) {
            // Default position if no sun data
            return { altitude: 45, azimuth: 180 };
        }

        const sunrise = this.weather.sunrise.getTime();
        const sunset = this.weather.sunset.getTime();
        const current = now.getTime();

        // Sun is not visible at night
        if (current < sunrise || current > sunset) {
            return { altitude: -10, azimuth: 0 }; // Below horizon
        }

        // Calculate day progress (0 = sunrise, 0.5 = solar noon, 1 = sunset)
        const dayLength = sunset - sunrise;
        const dayProgress = (current - sunrise) / dayLength;

        // Sun's altitude: peaks at solar noon (around 0.5 day progress)
        // Max altitude varies by season based on receiver latitude
        // Simplified: use parabolic curve peaking at solar noon
        const maxAltitude = 90 - Math.abs(this.receiverLat); // Rough approximation
        const altitude = maxAltitude * Math.sin(dayProgress * Math.PI);

        // Sun's azimuth: rises in east (90°), sets in west (270°)
        // 90° = east, 180° = south, 270° = west
        const azimuth = 90 + (dayProgress * 180); // East to West

        return { altitude, azimuth };
    }

    calculateMoonPhase() {
        // Calculate moon phase based on lunar cycle
        // Returns a value from 0 to 1 representing the moon phase
        // 0 = New Moon, 0.25 = First Quarter, 0.5 = Full Moon, 0.75 = Last Quarter
        const now = new Date();

        // Known new moon: January 11, 2024
        const knownNewMoon = new Date('2024-01-11T11:57:00Z').getTime();
        const lunarCycle = 29.53059 * 24 * 60 * 60 * 1000; // Lunar cycle in milliseconds

        const timeSinceNewMoon = now.getTime() - knownNewMoon;
        const phase = (timeSinceNewMoon % lunarCycle) / lunarCycle;

        return phase;
    }

    calculateMoonPosition() {
        // Calculate moon's position in the sky
        const now = new Date();

        if (!this.weather.sunrise || !this.weather.sunset) {
            return { altitude: 30, azimuth: 180 };
        }

        const sunrise = this.weather.sunrise.getTime();
        const sunset = this.weather.sunset.getTime();
        const current = now.getTime();

        // Moon is roughly 12 hours offset from sun
        // Simplified: moon is highest during night, low during day
        let moonProgress;

        if (current >= sunrise && current <= sunset) {
            // Daytime: moon may be visible, calculate based on day progress
            const dayLength = sunset - sunrise;
            const dayProg = (current - sunrise) / dayLength;
            moonProgress = dayProg + 0.5; // Offset from sun
        } else {
            // Nighttime: moon follows night cycle
            const midnight = new Date(now);
            midnight.setHours(0, 0, 0, 0);
            const nextMidnight = new Date(midnight.getTime() + 24 * 60 * 60 * 1000);

            if (current < sunrise) {
                // Before sunrise
                const nightLength = sunrise - midnight.getTime();
                moonProgress = (current - midnight.getTime()) / nightLength * 0.5;
            } else {
                // After sunset
                const nightLength = nextMidnight.getTime() - sunset;
                moonProgress = 0.5 + ((current - sunset) / nightLength * 0.5);
            }
        }

        // Moon's altitude calculation (visible mostly at night)
        const maxAltitude = 70;
        const altitude = maxAltitude * Math.sin(moonProgress * Math.PI);

        // Moon's azimuth (opposite side from sun generally)
        const azimuth = 90 + (moonProgress * 180);

        return { altitude, azimuth };
    }

    drawSun() {
        // Calculate sun position
        const sunPos = this.calculateSunPosition();

        // Don't draw sun if it's below horizon or not clear weather
        if (sunPos.altitude < 0) {
            return;
        }

        // Only show sun when clear or partly cloudy
        if (this.weather.condition === 'rain' || this.weather.condition === 'snow') {
            return;
        }

        // Check if sun is in current field of view
        if (!this.isInFieldOfView(sunPos.azimuth)) {
            return;
        }

        // Map sun's altitude (0-90°) to Y position in sky
        // 0° = horizon (bottom of sky), 90° = zenith (top of sky)
        const skyHeight = this.height - 60; // Sky area height
        const horizonY = skyHeight; // Bottom of sky
        const zenithY = 20; // Top of sky

        // Convert altitude to Y position (inverted because Y=0 is top)
        const sunY = horizonY - (sunPos.altitude / 90) * (horizonY - zenithY);

        // Map azimuth to X position based on current view direction
        const sunX = this.bearingToX(sunPos.azimuth);

        // Use sun.png if loaded, otherwise fall back to programmatic rendering
        if (this.sunImageLoaded && this.sunImage.complete) {
            // Draw sun.png with opacity based on weather
            const alpha = this.weather.condition === 'cloudy' ? 0.6 : 1.0;
            this.ctx.globalAlpha = alpha;

            // Size the sun image preserving aspect ratio
            const sunHeight = 80;
            const sunAspectRatio = this.sunImage.width / this.sunImage.height;
            const sunWidth = sunHeight * sunAspectRatio;
            this.ctx.drawImage(this.sunImage, sunX - sunWidth / 2, sunY - sunHeight / 2, sunWidth, sunHeight);

            this.ctx.globalAlpha = 1.0; // Reset alpha
        } else {
            // Fallback to programmatic sun rendering
            const pixelSize = 5;
            const alpha = this.weather.condition === 'cloudy' ? 0.6 : 1.0;

            // Outer glow
            this.ctx.fillStyle = `rgba(252, 212, 68, ${alpha * 0.3})`;
            this.ctx.fillRect(sunX - pixelSize * 3, sunY - pixelSize * 3, pixelSize * 6, pixelSize * 6);

            // Inner glow
            this.ctx.fillStyle = `rgba(252, 212, 68, ${alpha * 0.6})`;
            this.ctx.fillRect(sunX - pixelSize * 2, sunY - pixelSize * 2, pixelSize * 4, pixelSize * 4);

            // Sun core
            this.ctx.fillStyle = this.weather.condition === 'cloudy'
                ? 'rgba(252, 212, 68, 0.8)'
                : this.colors.sun;
            this.ctx.fillRect(sunX - pixelSize, sunY - pixelSize, pixelSize * 2, pixelSize * 2);

            // Sun rays (8 directions)
            const rayLength = pixelSize * 2;
            this.ctx.fillStyle = this.weather.condition === 'cloudy'
                ? 'rgba(252, 212, 68, 0.7)'
                : this.colors.sun;

            // Horizontal and vertical rays
            this.ctx.fillRect(sunX - rayLength - pixelSize, sunY - pixelSize / 2, pixelSize, pixelSize);
            this.ctx.fillRect(sunX + rayLength, sunY - pixelSize / 2, pixelSize, pixelSize);
            this.ctx.fillRect(sunX - pixelSize / 2, sunY - rayLength - pixelSize, pixelSize, pixelSize);
            this.ctx.fillRect(sunX - pixelSize / 2, sunY + rayLength, pixelSize, pixelSize);

            // Diagonal rays
            this.ctx.fillRect(sunX - rayLength, sunY - rayLength, pixelSize, pixelSize);
            this.ctx.fillRect(sunX + rayLength - pixelSize, sunY - rayLength, pixelSize, pixelSize);
            this.ctx.fillRect(sunX - rayLength, sunY + rayLength - pixelSize, pixelSize, pixelSize);
            this.ctx.fillRect(sunX + rayLength - pixelSize, sunY + rayLength - pixelSize, pixelSize, pixelSize);
        }
    }

    getMoonSpritePosition(phase) {
        // Map moon phase (0-1) to sprite sheet position (2x3 grid)
        // Row 0: waxing crescent, first quarter, waxing gibbous
        // Row 1: full moon, waning gibbous, last quarter

        if (phase < 0.05 || phase > 0.95) {
            // New moon - don't display
            return null;
        } else if (phase >= 0.05 && phase < 0.20) {
            // Waxing crescent
            return { row: 0, col: 0 };
        } else if (phase >= 0.20 && phase < 0.30) {
            // First quarter
            return { row: 0, col: 1 };
        } else if (phase >= 0.30 && phase < 0.48) {
            // Waxing gibbous
            return { row: 0, col: 2 };
        } else if (phase >= 0.48 && phase <= 0.52) {
            // Full moon
            return { row: 1, col: 0 };
        } else if (phase > 0.52 && phase < 0.70) {
            // Waning gibbous
            return { row: 1, col: 1 };
        } else if (phase >= 0.70 && phase < 0.80) {
            // Last quarter
            return { row: 1, col: 2 };
        } else {
            // Waning crescent (0.80-0.95) - mirror waxing crescent
            return { row: 0, col: 0, mirror: true };
        }
    }

    drawMoon() {
        // Calculate moon position and phase
        const moonPos = this.calculateMoonPosition();
        const phase = this.calculateMoonPhase();

        // Don't draw moon if it's below horizon
        if (moonPos.altitude < 0) {
            return;
        }

        // Moon is more visible at night, less during day
        const sunPos = this.calculateSunPosition();
        const isNight = sunPos.altitude < 0;

        // Only show moon at night or if it's high enough during day
        if (!isNight && moonPos.altitude < 30) {
            return;
        }

        // Check if moon is in current field of view
        if (!this.isInFieldOfView(moonPos.azimuth)) {
            return;
        }

        // Map moon's altitude to Y position
        const skyHeight = this.height - 60;
        const horizonY = skyHeight;
        const zenithY = 20;
        const moonY = horizonY - (moonPos.altitude / 90) * (horizonY - zenithY);

        // Map azimuth to X position based on current view direction
        const moonX = this.bearingToX(moonPos.azimuth);

        // Use sprite sheet if loaded
        if (this.moonSpriteLoaded && this.moonSprite.complete) {
            const spritePos = this.getMoonSpritePosition(phase);

            // Don't draw during new moon
            if (!spritePos) {
                return;
            }

            // Calculate sprite sheet dimensions (2x3 grid)
            const spriteWidth = this.moonSprite.width / 3;  // 3 columns
            const spriteHeight = this.moonSprite.height / 2; // 2 rows

            // Source rectangle (which part of sprite sheet to use)
            const sx = spritePos.col * spriteWidth;
            const sy = spritePos.row * spriteHeight;

            // Destination size (scaled for display, maintaining aspect ratio)
            const spriteAspectRatio = spriteWidth / spriteHeight;
            const targetHeight = 120; // 200% scale (was 60)
            const targetWidth = targetHeight * spriteAspectRatio;
            const destX = moonX - targetWidth / 2;
            const destY = moonY - targetHeight / 2;

            // Moon brightness (brighter at night)
            const alpha = isNight ? 1.0 : 0.6;
            this.ctx.globalAlpha = alpha;

            // Draw moon with optional horizontal flip for waning crescent
            if (spritePos.mirror) {
                this.ctx.save();
                this.ctx.translate(moonX, moonY);
                this.ctx.scale(-1, 1);
                this.ctx.drawImage(
                    this.moonSprite,
                    sx, sy, spriteWidth, spriteHeight,
                    -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight
                );
                this.ctx.restore();
            } else {
                this.ctx.drawImage(
                    this.moonSprite,
                    sx, sy, spriteWidth, spriteHeight,
                    destX, destY, targetWidth, targetHeight
                );
            }

            this.ctx.globalAlpha = 1.0;
        }
    }

    drawGround() {
        // Use directional background for current view direction
        const bgImage = this.backgroundImages[this.viewDirection];
        const bgLoaded = this.backgroundImagesLoaded[this.viewDirection];

        if (bgLoaded && bgImage && bgImage.complete) {
            const bgAspectRatio = bgImage.width / bgImage.height;
            const bgWidth = this.width;
            const bgHeight = this.width / bgAspectRatio;
            const bgY = this.height - bgHeight;
            const bgX = 0;

            this.ctx.drawImage(bgImage, bgX, bgY, bgWidth, bgHeight);
        }
    }

    drawGrid() {
        this.ctx.strokeStyle = this.colors.grid;
        this.ctx.lineWidth = 1;

        // Horizontal lines every 10,000 feet
        for (let alt = 0; alt <= 50000; alt += 10000) {
            const y = this.height - 60 - (alt / 50000) * (this.height - 100);
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
    }

    calculateScale() {
        let minLat = this.receiverLat;
        let maxLat = this.receiverLat;
        let maxAltitude = 0;

        this.flights.forEach(flight => {
            minLat = Math.min(minLat, flight.lat);
            maxLat = Math.max(maxLat, flight.lat);
            maxAltitude = Math.max(maxAltitude, flight.altitude);
        });

        // Add more padding for better horizontal spacing
        // Ensure minimum range of 1.0 degree latitude (about 60 nautical miles)
        const latRange = Math.max((maxLat - minLat) * 2.5, 1.0);

        // Center the view around receiver with extra padding
        const latCenter = (minLat + maxLat) / 2;
        minLat = latCenter - latRange / 2;
        maxLat = latCenter + latRange / 2;

        maxAltitude = Math.max(maxAltitude * 1.2, 10000); // Minimum 10,000 feet

        return {
            latScale: (this.width - 100) / (maxLat - minLat), // Pixels per degree latitude
            altScale: (this.height - 100) / maxAltitude, // Pixels per foot
            minLat,
            maxLat,
            maxAltitude
        };
    }

    drawMountains() {
        const sprite = this.sprites.mountain;
        const spriteHeight = sprite.length;
        const spriteWidth = sprite[0].length;
        const pixelSize = 4;
        const groundY = this.height - 60;
        const mountainY = groundY - (spriteHeight * pixelSize); // Connect to ground

        // Draw multiple mountains across the horizon
        for (let mountainX = -50; mountainX < this.width; mountainX += 120) {
            for (let y = 0; y < spriteHeight; y++) {
                for (let x = 0; x < spriteWidth; x++) {
                    if (sprite[y][x] === 1 || sprite[y][x] === 2) {
                        // Snow caps (value 2)
                        if (sprite[y][x] === 2) {
                            this.ctx.fillStyle = this.colors.mountainSnow;
                        } else {
                            this.ctx.fillStyle = this.colors.mountain;
                        }

                        this.ctx.fillRect(
                            mountainX + x * pixelSize,
                            mountainY + y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                    }
                }
            }
        }
    }

    drawCacti() {
        const sprite = this.sprites.cactus;
        const spriteHeight = sprite.length;
        const spriteWidth = sprite[0].length;
        const pixelSize = 2;
        const groundY = this.height - 60;

        // Draw cacti at various positions along the ground
        const cactusPositions = [100, 250, 350, 550, 700];

        cactusPositions.forEach(cactusX => {
            for (let y = 0; y < spriteHeight; y++) {
                for (let x = 0; x < spriteWidth; x++) {
                    if (sprite[y][x] === 1) {
                        // Randomize cactus shading slightly
                        this.ctx.fillStyle = (x + y) % 3 === 0 ? this.colors.cactusDark : this.colors.cactus;

                        this.ctx.fillRect(
                            cactusX + x * pixelSize,
                            groundY - spriteHeight * pixelSize + y * pixelSize,
                            pixelSize,
                            pixelSize
                        );
                    }
                }
            }
        });
    }

    drawWeather() {
        if (this.weather.condition === 'rain') {
            this.ctx.fillStyle = this.colors.rain;
            // Draw rain drops
            for (let i = 0; i < 100; i++) {
                const x = Math.random() * this.width;
                const y = (Math.random() * (this.height - 60)) + (Date.now() / 10) % this.height;
                this.ctx.fillRect(x, y % (this.height - 60), 1, 8);
            }
        } else if (this.weather.condition === 'snow') {
            this.ctx.fillStyle = this.colors.snow;
            // Draw snowflakes
            for (let i = 0; i < 50; i++) {
                const x = (Math.random() * this.width + Date.now() / 50) % this.width;
                const y = (Math.random() * (this.height - 60) + Date.now() / 30) % (this.height - 60);
                this.ctx.fillRect(x, y, 3, 3);
            }
        }
    }

    drawHouse(scale) {
        // Position antenna based on receiver latitude
        const antennaX = 50 + (this.receiverLat - scale.minLat) * scale.latScale;
        const antennaY = this.height - 60;
        const pixelSize = 2;

        const sprite = this.sprites.antenna;
        const spriteWidth = sprite[0].length;
        const spriteHeight = sprite.length;

        for (let y = 0; y < spriteHeight; y++) {
            for (let x = 0; x < spriteWidth; x++) {
                const pixel = sprite[y][x];
                if (pixel > 0) {
                    // Choose color based on pixel value
                    if (pixel === 1) {
                        // Mast - silver with subtle shading
                        this.ctx.fillStyle = (x === 1) ? this.colors.antennaDark : this.colors.antenna;
                    } else if (pixel === 2) {
                        // White rings
                        this.ctx.fillStyle = this.colors.antennaRing;
                    } else if (pixel === 3) {
                        // Dark base
                        this.ctx.fillStyle = this.colors.antennaBase;
                    }

                    this.ctx.fillRect(
                        antennaX - (spriteWidth * pixelSize / 2) + x * pixelSize,
                        antennaY - spriteHeight * pixelSize + y * pixelSize,
                        pixelSize,
                        pixelSize
                    );
                }
            }
        }
    }

    getAircraftColor(pixelValue, isFlyingTowards) {
        // Map sprite pixel values to colors
        // 1 = fuselage, 2 = windows, 3 = wings, 4 = tail, 5 = engine
        switch(pixelValue) {
            case 1: // Fuselage - use direction-based color (white or green/orange)
                return isFlyingTowards ? this.colors.planeTowards : this.colors.planeAway;
            case 2: // Windows - light blue/cyan
                return '#54d4fc';
            case 3: // Wings - gray
                return '#a0a0a0';
            case 4: // Tail - red accent
                return '#fc5454';
            case 5: // Engine - dark gray
                return '#606060';
            default:
                return this.colors.plane;
        }
    }

    // Check if two rectangles overlap
    rectsOverlap(r1, r2) {
        return !(r1.right < r2.left || r1.left > r2.right || r1.bottom < r2.top || r1.top > r2.bottom);
    }

    // Find a non-overlapping position for a label
    findLabelPosition(x, baseY, labelWidth, labelHeight, placedLabels) {
        // Try different positions: below, above, left-below, right-below, further below
        const offsets = [
            { dx: 0, dy: 0 },           // Default position
            { dx: 0, dy: -70 },         // Above aircraft
            { dx: 80, dy: 0 },          // Right
            { dx: -80, dy: 0 },         // Left
            { dx: 80, dy: -35 },        // Right-up
            { dx: -80, dy: -35 },       // Left-up
            { dx: 0, dy: 40 },          // Further below
            { dx: 100, dy: -70 },       // Far right-up
            { dx: -100, dy: -70 },      // Far left-up
        ];

        for (const offset of offsets) {
            const testRect = {
                left: x - labelWidth / 2 + offset.dx,
                right: x + labelWidth / 2 + offset.dx,
                top: baseY + offset.dy,
                bottom: baseY + labelHeight + offset.dy
            };

            // Check if this position overlaps with any placed label
            let hasOverlap = false;
            for (const placed of placedLabels) {
                if (this.rectsOverlap(testRect, placed)) {
                    hasOverlap = true;
                    break;
                }
            }

            if (!hasOverlap) {
                return { x: x + offset.dx, y: baseY + offset.dy, rect: testRect };
            }
        }

        // If all positions overlap, return default (will overlap but at least shows)
        return {
            x: x,
            y: baseY,
            rect: {
                left: x - labelWidth / 2,
                right: x + labelWidth / 2,
                top: baseY,
                bottom: baseY + labelHeight
            }
        };
    }

    drawAircraft(scale) {
        let maxRange = 0;
        let visibleCount = 0;
        const aircraftData = []; // Collect aircraft data for hover and sidebar

        // First pass: draw all aircraft and collect data
        this.flights.forEach(flight => {
            // Calculate bearing from receiver to aircraft
            const bearing = this.calculateBearing(
                this.receiverLat, this.receiverLon,
                flight.lat, flight.lon
            );

            // Skip if not in current field of view
            if (!this.isInFieldOfView(bearing)) {
                return;
            }

            visibleCount++;

            // Calculate distance for range display and sprite scaling
            const distance = this.calculateDistance(
                this.receiverLat, this.receiverLon,
                flight.lat, flight.lon
            );
            maxRange = Math.max(maxRange, distance);

            // Calculate distance-based scale factor
            // Close (0-10 NM) = large, Far (100+ NM) = small but still visible
            const minScale = 0.35;  // Minimum 35% size at far distance
            const maxScale = 1.1;   // Maximum 110% size when very close
            const nearDistance = 5;  // Distance (NM) for max scale
            const farDistance = 80;  // Distance (NM) for min scale

            let distanceScale;
            if (distance <= nearDistance) {
                distanceScale = maxScale;
            } else if (distance >= farDistance) {
                distanceScale = minScale;
            } else {
                // Smooth interpolation between near and far
                const t = (distance - nearDistance) / (farDistance - nearDistance);
                distanceScale = maxScale - (t * (maxScale - minScale));
            }

            // X position based on bearing within field of view
            const x = this.bearingToX(bearing);

            // Y position: altitude
            const y = this.height - 60 - (flight.altitude * scale.altScale);

            // Skip if out of bounds
            if (x < 0 || x > this.width || y < 0 || y > this.height - 60) {
                return;
            }

            // Get aircraft category and image
            const category = this.aircraftTypes.get(flight.icao) || 'narrowBody';
            const aircraftImage = this.aircraftImages[category];
            const imageLoaded = this.aircraftImagesLoaded[category];

            // Determine if flying left or right relative to viewer
            // Compare aircraft track to view direction
            // If track is to the left of view direction, aircraft appears to fly left
            let trackRelative = flight.track - this.viewDirection;
            if (trackRelative > 180) trackRelative -= 360;
            if (trackRelative < -180) trackRelative += 360;
            const isFacingLeft = trackRelative < 0 || trackRelative > 180;

            // Determine flight direction for color coding
            const isFlyingTowards = this.isFlyingTowards(flight);

            this.ctx.save();

            let spriteHeight = 110; // Default for PNG

            // Use PNG image if loaded, otherwise fall back to sprite array
            if (imageLoaded && aircraftImage) {
                // Apply distance-based scaling to base height
                const baseHeight = 110;
                const targetHeight = baseHeight * distanceScale;
                const imageScale = targetHeight / aircraftImage.height;
                const scaledWidth = aircraftImage.width * imageScale;
                const scaledHeight = aircraftImage.height * imageScale;
                spriteHeight = scaledHeight;

                this.ctx.globalAlpha = 1.0;
                this.ctx.filter = 'none';

                if (isFacingLeft) {
                    this.ctx.translate(x, y);
                    this.ctx.scale(-1, 1);
                    this.ctx.drawImage(aircraftImage, -scaledWidth / 2, -scaledHeight / 2, scaledWidth, scaledHeight);
                } else {
                    this.ctx.drawImage(aircraftImage, x - scaledWidth / 2, y - scaledHeight / 2, scaledWidth, scaledHeight);
                }
            } else {
                // Fallback to sprite array rendering with distance scaling
                const sprite = this.getAircraftSprite(flight.icao);
                const spriteWidth = sprite[0].length;
                const spriteH = sprite.length;
                const basePixelSize = 2;
                const pixelSize = basePixelSize * distanceScale;
                spriteHeight = spriteH * pixelSize;

                for (let row = 0; row < spriteH; row++) {
                    for (let col = 0; col < spriteWidth; col++) {
                        const pixelValue = sprite[row][col];
                        if (pixelValue > 0) {
                            this.ctx.fillStyle = this.getAircraftColor(pixelValue, isFlyingTowards);
                            let drawX, drawY;
                            if (isFacingLeft) {
                                drawX = x + (spriteWidth - 1 - col) * pixelSize - (spriteWidth * pixelSize / 2);
                                drawY = y + row * pixelSize - (spriteH * pixelSize / 2);
                            } else {
                                drawX = x + col * pixelSize - (spriteWidth * pixelSize / 2);
                                drawY = y + row * pixelSize - (spriteH * pixelSize / 2);
                            }
                            this.ctx.fillRect(drawX, drawY, pixelSize, pixelSize);
                        }
                    }
                }
            }

            this.ctx.restore();

            // Calculate sprite width for hover detection
            let spriteWidth = spriteHeight * 1.5; // Approximate aspect ratio

            // Collect data for hover detection and sidebar
            aircraftData.push({
                x,
                y,
                spriteWidth,
                spriteHeight,
                callsign: flight.callsign || flight.icao,
                icao: flight.icao,
                altitude: flight.altitude,
                distance: distance,
                speed: flight.speed || 0
            });
        });

        // Check for hover and draw label for hovered aircraft
        this.hoveredAircraft = null;
        for (const aircraft of aircraftData) {
            // Check if mouse is over this aircraft
            const halfW = aircraft.spriteWidth / 2;
            const halfH = aircraft.spriteHeight / 2;
            if (this.mouseX >= aircraft.x - halfW && this.mouseX <= aircraft.x + halfW &&
                this.mouseY >= aircraft.y - halfH && this.mouseY <= aircraft.y + halfH) {
                this.hoveredAircraft = aircraft;
                break;
            }
        }

        // Find selected aircraft (from sidebar click)
        let selectedAircraft = null;
        if (this.selectedAircraftIcao) {
            selectedAircraft = aircraftData.find(a => a.icao === this.selectedAircraftIcao);
        }

        // Draw highlight box around selected aircraft
        if (selectedAircraft) {
            const aircraft = selectedAircraft;
            const padding = 15;
            const halfW = aircraft.spriteWidth / 2 + padding;
            const halfH = aircraft.spriteHeight / 2 + padding;

            // Animated pulsing border
            const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;

            // Draw glowing box around aircraft
            this.ctx.strokeStyle = `rgba(252, 212, 68, ${pulse})`;
            this.ctx.lineWidth = 4;
            this.ctx.strokeRect(aircraft.x - halfW, aircraft.y - halfH, halfW * 2, halfH * 2);

            // Draw corner brackets for extra visibility
            const bracketSize = 15;
            this.ctx.strokeStyle = '#fcd444';
            this.ctx.lineWidth = 3;

            // Top-left
            this.ctx.beginPath();
            this.ctx.moveTo(aircraft.x - halfW, aircraft.y - halfH + bracketSize);
            this.ctx.lineTo(aircraft.x - halfW, aircraft.y - halfH);
            this.ctx.lineTo(aircraft.x - halfW + bracketSize, aircraft.y - halfH);
            this.ctx.stroke();

            // Top-right
            this.ctx.beginPath();
            this.ctx.moveTo(aircraft.x + halfW - bracketSize, aircraft.y - halfH);
            this.ctx.lineTo(aircraft.x + halfW, aircraft.y - halfH);
            this.ctx.lineTo(aircraft.x + halfW, aircraft.y - halfH + bracketSize);
            this.ctx.stroke();

            // Bottom-left
            this.ctx.beginPath();
            this.ctx.moveTo(aircraft.x - halfW, aircraft.y + halfH - bracketSize);
            this.ctx.lineTo(aircraft.x - halfW, aircraft.y + halfH);
            this.ctx.lineTo(aircraft.x - halfW + bracketSize, aircraft.y + halfH);
            this.ctx.stroke();

            // Bottom-right
            this.ctx.beginPath();
            this.ctx.moveTo(aircraft.x + halfW - bracketSize, aircraft.y + halfH);
            this.ctx.lineTo(aircraft.x + halfW, aircraft.y + halfH);
            this.ctx.lineTo(aircraft.x + halfW, aircraft.y + halfH - bracketSize);
            this.ctx.stroke();
        }

        // Draw label for hovered or selected aircraft
        const labelAircraft = this.hoveredAircraft || selectedAircraft;
        if (labelAircraft) {
            const aircraft = labelAircraft;
            this.ctx.font = 'bold 14px "Press Start 2P", "Pixelify Sans", monospace';
            this.ctx.textAlign = 'center';

            const callsign = aircraft.callsign;
            const altText = `FL${Math.round(aircraft.altitude / 100)}`;
            const distText = `${Math.round(aircraft.distance)} NM`;

            // Draw label above the aircraft
            const labelY = aircraft.y - aircraft.spriteHeight / 2 - 10;

            // Draw background box for label
            const labelWidth = Math.max(callsign.length, altText.length, distText.length) * 12 + 16;
            const labelHeight = 52;
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            this.ctx.fillRect(aircraft.x - labelWidth / 2, labelY - labelHeight, labelWidth, labelHeight);
            this.ctx.strokeStyle = selectedAircraft && !this.hoveredAircraft ? '#fcd444' : '#5c94fc';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(aircraft.x - labelWidth / 2, labelY - labelHeight, labelWidth, labelHeight);

            // Draw text
            this.drawTextWithShadow(callsign, aircraft.x, labelY - 34);
            this.drawTextWithShadow(altText, aircraft.x, labelY - 20);
            this.drawTextWithShadow(distText, aircraft.x, labelY - 6);
        }

        // Update visible aircraft list for sidebar (sorted by distance)
        this.visibleAircraftList = aircraftData.sort((a, b) => a.distance - b.distance);

        // Throttle DOM updates to reduce flashing (update every 500ms)
        const now = Date.now();

        if (now - this.lastSidebarUpdate > 500) {
            this.updateAircraftSidebar();
            this.lastSidebarUpdate = now;
        }

        // Only update stats if values changed (prevents flashing)
        const rangeText = `RANGE: ${Math.round(maxRange)} NM`;
        const countText = `AIRCRAFT: ${visibleCount}/${this.flights.size}`;

        if (this.cachedRangeText !== rangeText) {
            this.cachedRangeText = rangeText;
            const rangeEl = document.getElementById('range-display');
            if (rangeEl) rangeEl.textContent = rangeText;
        }

        if (this.cachedCountText !== countText) {
            this.cachedCountText = countText;
            const countEl = document.getElementById('aircraft-count');
            if (countEl) countEl.textContent = countText;
        }
    }

    updateAircraftSidebar() {
        const sidebar = document.getElementById('aircraft-sidebar');
        if (!sidebar) return;

        // Get or create the list container (preserving the header)
        let listContainer = sidebar.querySelector('.sidebar-list');
        if (!listContainer) {
            listContainer = document.createElement('div');
            listContainer.className = 'sidebar-list';
            sidebar.appendChild(listContainer);
        }

        if (this.visibleAircraftList.length === 0) {
            listContainer.innerHTML = '<div class="sidebar-empty">No aircraft in view</div>';
            return;
        }

        let html = '';
        for (const aircraft of this.visibleAircraftList) {
            const altFL = Math.round(aircraft.altitude / 100);
            const dist = Math.round(aircraft.distance);
            const isSelected = aircraft.icao === this.selectedAircraftIcao;
            const selectedClass = isSelected ? ' selected' : '';
            html += `<div class="sidebar-aircraft${selectedClass}" data-icao="${aircraft.icao}">
                <span class="sidebar-callsign">${aircraft.callsign}</span>
                <span class="sidebar-info">FL${altFL} · ${dist}NM</span>
            </div>`;
        }

        // Only update DOM if content changed (prevents flashing)
        if (listContainer.innerHTML !== html) {
            listContainer.innerHTML = html;
        }
    }

    drawScaleIndicators(scale) {
        this.ctx.font = 'bold 11px "Courier New"';

        // Altitude scale (left side)
        this.ctx.textAlign = 'left';
        for (let alt = 0; alt <= scale.maxAltitude; alt += 10000) {
            const y = this.height - 60 - (alt * scale.altScale);
            if (y > 10 && y < this.height - 70) {
                this.drawTextWithShadow(`${Math.round(alt / 1000)}K`, 5, y + 3);
            }
        }
    }

    drawCompassIndicators() {
        this.ctx.font = 'bold 14px "Press Start 2P", "Pixelify Sans", monospace';
        this.ctx.textAlign = 'center';

        // Calculate left and right edge directions based on current view
        const leftDir = (this.viewDirection - 45 + 360) % 360;
        const rightDir = (this.viewDirection + 45) % 360;
        const centerDir = this.viewDirection;

        // Direction labels
        const dirLabels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        const getDir = (deg) => dirLabels[deg] || dirLabels[Math.round(deg / 45) * 45 % 360] || '';

        // Left edge direction
        this.drawTextWithShadow(getDir(leftDir), 35, this.height - 35);

        // Right edge direction
        this.drawTextWithShadow(getDir(rightDir), this.width - 35, this.height - 35);

        // Current view direction at top center
        const fullNames = { 0: 'NORTH', 90: 'EAST', 180: 'SOUTH', 270: 'WEST' };
        this.ctx.font = 'bold 16px "Press Start 2P", "Pixelify Sans", monospace';
        this.drawTextWithShadow(`◄ ${fullNames[centerDir]} ►`, this.width / 2, 25);

        // Location label at bottom center
        this.ctx.font = 'bold 12px "Press Start 2P", "Pixelify Sans", monospace';
        this.drawTextWithShadow(this.locationName, this.width / 2, this.height - 10);
    }

    drawTextWithShadow(text, x, y) {
        // Shadow
        this.ctx.fillStyle = this.colors.textShadow;
        this.ctx.fillText(text, x + 1, y + 1);
        // Main text
        this.ctx.fillStyle = this.colors.text;
        this.ctx.fillText(text, x, y);
    }
}

// Initialize the app
const app = new PixelADSB();
