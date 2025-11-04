// Configuration
// Automatically detect if running locally or on production
const API_BASE_URL = window.location.origin;
const GEOAPIFY_API_KEY = 'aacb5a4e767e4e5993d5b2e4202bf541';

// Global variables
let socket;
let map;
let currentUser = {
    username: '',
    groupId: '',
    location: null
};
let groupDestination = null;
let userMarkers = {};
let destinationMarker = null;
let routeLayer = null;
let locationTracking = false;
let watchId = null;

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    setupEventListeners();
    showWelcomeModal();
});

// Initialize Map
function initializeMap() {
    map = L.map('map').setView([51.505, -0.09], 13);
    
    // Use Geoapify tiles
    L.tileLayer(`https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey=${GEOAPIFY_API_KEY}`, {
        attribution: '&copy; <a href="https://www.geoapify.com/">Geoapify</a>',
        maxZoom: 20
    }).addTo(map);
    
    // Get user's current location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords;
            currentUser.location = { latitude, longitude };
            map.setView([latitude, longitude], 13);
            
            // Add user marker
            addUserMarker(currentUser.username, latitude, longitude, true);
        }, (error) => {
            console.error('Error getting location:', error);
            showAlert('Unable to get your location. Please enable location services.', 'danger');
        });
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // Welcome modal
    document.getElementById('createGroupBtn').addEventListener('click', () => {
        const username = document.getElementById('usernameInput').value.trim();
        if (!username) {
            showAlert('Please enter your name', 'warning');
            return;
        }
        currentUser.username = username;
        hideModal('welcomeModal');
        showModal('createGroupModal');
    });
    
    document.getElementById('joinGroupBtn').addEventListener('click', async () => {
        const username = document.getElementById('usernameInput').value.trim();
        if (!username) {
            showAlert('Please enter your name', 'warning');
            return;
        }
        currentUser.username = username;
        hideModal('welcomeModal');
        showModal('joinGroupModal');
        await loadAvailableGroups();
    });
    
    // Create group
    document.getElementById('confirmCreateGroupBtn').addEventListener('click', async () => {
        const groupName = document.getElementById('groupNameInput').value.trim();
        if (!groupName) {
            showAlert('Please enter a group name', 'warning');
            return;
        }
        await createGroup(groupName);
    });
    
    // Join group
    document.getElementById('confirmJoinGroupBtn').addEventListener('click', async () => {
        const groupId = document.getElementById('groupIdInput').value.trim();
        if (!groupId) {
            showAlert('Please enter a group ID', 'warning');
            return;
        }
        await joinGroup(groupId);
    });
    
    // Destination
    document.getElementById('setDestinationBtn').addEventListener('click', () => {
        showModal('destinationModal');
    });
    
    document.getElementById('clearDestinationBtn').addEventListener('click', clearDestination);
    
    document.getElementById('searchDestinationBtn').addEventListener('click', searchDestination);
    
    document.getElementById('confirmDestinationBtn').addEventListener('click', setDestination);
    
    // Map controls
    document.getElementById('centerMapBtn').addEventListener('click', centerMap);
    
    document.getElementById('toggleTrackingBtn').addEventListener('click', toggleLocationTracking);
    
    document.getElementById('suggestMeetingBtn').addEventListener('click', suggestMeetingPoint);
    
    // Close buttons
    document.getElementById('closeCreateModal').addEventListener('click', () => {
        hideModal('createGroupModal');
        showModal('welcomeModal');
    });
    
    document.getElementById('closeJoinModal').addEventListener('click', () => {
        hideModal('joinGroupModal');
        showModal('welcomeModal');
    });
    
    document.getElementById('closeDestinationModal').addEventListener('click', () => {
        hideModal('destinationModal');
    });
}

// Socket.IO Connection
function connectSocket() {
    socket = io(API_BASE_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5
    });
    
    socket.on('connect', () => {
        console.log('Connected to server');
        showAlert('Connected to server!', 'success');
        socket.emit('joinGroup', {
            username: currentUser.username,
            groupId: currentUser.groupId
        });
    });
    
    socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        showAlert('Connection error. Retrying...', 'warning');
    });
    
    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        showAlert('Disconnected from server', 'warning');
    });
    
    socket.on('reconnect', (attemptNumber) => {
        console.log('Reconnected after', attemptNumber, 'attempts');
        showAlert('Reconnected to server!', 'success');
    });
    
    socket.on('groupMembers', (members) => {
        updateMembersList(members);
    });
    
    // Handle complete group state when joining
    socket.on('groupState', (data) => {
        console.log('Received group state:', data);
        
        // Update members list
        if (data.members) {
            updateMembersList(data.members);
            
            // Display all members' locations on map
            data.members.forEach(member => {
                if (member.currentLocation && member.currentLocation.latitude) {
                    addUserMarker(
                        member.username,
                        member.currentLocation.latitude,
                        member.currentLocation.longitude,
                        member.username === currentUser.username
                    );
                }
            });
        }
        
        // Set destination if it exists
        if (data.destination && data.destination.latitude) {
            groupDestination = data.destination;
            updateDestinationDisplay(data.destination);
            addDestinationMarker(data.destination.latitude, data.destination.longitude);
            
            // Calculate route if user has location
            if (currentUser.location) {
                calculateRoute();
            }
        }
    });
    
    socket.on('memberLocationUpdate', (data) => {
        const { username, latitude, longitude, eta } = data;
        console.log(`Location update from ${username}:`, latitude, longitude);
        addUserMarker(username, latitude, longitude, username === currentUser.username);
        updateMemberETA(username, eta);
        
        // Fit map to show all markers
        fitMapToMarkers();
    });
    
    socket.on('userJoined', async (data) => {
        showAlert(`${data.username} joined the group!`, 'success');
        
        // Refresh members list
        try {
            const response = await fetch(`${API_BASE_URL}/api/users/${currentUser.groupId}`);
            const members = await response.json();
            updateMembersList(members);
        } catch (error) {
            console.error('Error refreshing members:', error);
        }
    });
    
    socket.on('userLeft', (data) => {
        showAlert(`${data.username} left the group`, 'info');
        removeUserMarker(data.username);
    });
    
    socket.on('destinationSet', (destination) => {
        groupDestination = destination;
        updateDestinationDisplay(destination);
        addDestinationMarker(destination.latitude, destination.longitude);
        if (currentUser.location) {
            calculateRoute();
        }
        // Show clear button
        document.getElementById('clearDestinationBtn').style.display = 'block';
    });
    
    socket.on('destinationCleared', () => {
        console.log('Destination cleared by another member');
        clearDestinationUI();
        showAlert('Destination has been cleared', 'info');
    });
    
    socket.on('alert', (alert) => {
        showAlert(alert.message, alert.type === 'delay' ? 'warning' : 'danger');
    });
}

// API Functions
async function createGroup(groupName) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/groups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                groupName,
                createdBy: currentUser.username
            })
        });
        
        const group = await response.json();
        currentUser.groupId = group.groupId;
        
        hideModal('createGroupModal');
        updateGroupDisplay(group);
        connectSocket();
        startLocationTracking();
        
        showAlert(`Group "${groupName}" created! Share this ID: ${group.groupId}`, 'success');
    } catch (error) {
        console.error('Error creating group:', error);
        showAlert('Failed to create group', 'danger');
    }
}

async function joinGroup(groupId) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: currentUser.username })
        });
        
        if (!response.ok) {
            throw new Error('Group not found');
        }
        
        const group = await response.json();
        currentUser.groupId = groupId;
        
        hideModal('joinGroupModal');
        updateGroupDisplay(group);
        connectSocket();
        startLocationTracking();
        
        if (group.destination) {
            groupDestination = group.destination;
            updateDestinationDisplay(group.destination);
            addDestinationMarker(group.destination.latitude, group.destination.longitude);
        }
        
        showAlert(`Joined group "${group.groupName}"!`, 'success');
    } catch (error) {
        console.error('Error joining group:', error);
        showAlert('Failed to join group. Please check the group ID.', 'danger');
    }
}

async function loadAvailableGroups() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/groups`);
        const groups = await response.json();
        
        const groupsList = document.getElementById('groupsList');
        groupsList.innerHTML = '';
        
        if (groups.length === 0) {
            groupsList.innerHTML = '<p class="no-groups">No active groups available</p>';
            return;
        }
        
        groups.forEach(group => {
            const groupItem = document.createElement('div');
            groupItem.className = 'group-item';
            groupItem.innerHTML = `
                <strong>${group.groupName}</strong><br>
                <small>ID: ${group.groupId}</small><br>
                <small>Members: ${group.members.length}</small>
            `;
            groupItem.addEventListener('click', () => {
                document.getElementById('groupIdInput').value = group.groupId;
            });
            groupsList.appendChild(groupItem);
        });
    } catch (error) {
        console.error('Error loading groups:', error);
    }
}

// Search destination using Geoapify
async function searchDestination() {
    const query = document.getElementById('destinationInput').value.trim();
    if (!query) {
        showAlert('Please enter a location', 'warning');
        return;
    }
    
    try {
        const response = await fetch(
            `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(query)}&apiKey=${GEOAPIFY_API_KEY}`
        );
        const data = await response.json();
        
        const resultsContainer = document.getElementById('searchResults');
        resultsContainer.innerHTML = '';
        
        if (data.features.length === 0) {
            resultsContainer.innerHTML = '<p class="no-results">No results found</p>';
            return;
        }
        
        data.features.slice(0, 5).forEach(feature => {
            const item = document.createElement('div');
            item.className = 'search-result-item';
            item.innerHTML = `
                <strong>${feature.properties.formatted}</strong><br>
                <small>${feature.properties.lat.toFixed(6)}, ${feature.properties.lon.toFixed(6)}</small>
            `;
            item.addEventListener('click', () => {
                document.getElementById('destLatInput').value = feature.properties.lat;
                document.getElementById('destLngInput').value = feature.properties.lon;
                resultsContainer.innerHTML = '';
            });
            resultsContainer.appendChild(item);
        });
    } catch (error) {
        console.error('Error searching destination:', error);
        showAlert('Failed to search location', 'danger');
    }
}

async function setDestination() {
    const lat = parseFloat(document.getElementById('destLatInput').value);
    const lng = parseFloat(document.getElementById('destLngInput').value);
    
    if (isNaN(lat) || isNaN(lng)) {
        showAlert('Please provide valid coordinates', 'warning');
        return;
    }
    
    try {
        // Reverse geocode to get address
        const response = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lng}&apiKey=${GEOAPIFY_API_KEY}`
        );
        const data = await response.json();
        const address = data.features[0]?.properties.formatted || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        
        // Set destination for group
        await fetch(`${API_BASE_URL}/api/groups/${currentUser.groupId}/destination`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, address })
        });
        
        groupDestination = { latitude: lat, longitude: lng, address };
        updateDestinationDisplay(groupDestination);
        addDestinationMarker(lat, lng);
        calculateRoute();
        
        // Show clear button
        document.getElementById('clearDestinationBtn').style.display = 'block';
        
        hideModal('destinationModal');
        showAlert('Destination set successfully!', 'success');
    } catch (error) {
        console.error('Error setting destination:', error);
        showAlert('Failed to set destination', 'danger');
    }
}

async function clearDestination() {
    if (!currentUser.groupId) {
        showAlert('You must be in a group to clear destination', 'warning');
        return;
    }
    
    if (!groupDestination) {
        showAlert('No destination set', 'info');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/groups/${currentUser.groupId}/destination`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Failed to clear destination');
        }
        
        clearDestinationUI();
        showAlert('Destination cleared successfully!', 'success');
    } catch (error) {
        console.error('Error clearing destination:', error);
        showAlert('Failed to clear destination', 'danger');
    }
}

function clearDestinationUI() {
    // Clear destination variable
    groupDestination = null;
    
    // Remove destination marker from map
    if (destinationMarker) {
        map.removeLayer(destinationMarker);
        destinationMarker = null;
    }
    
    // Remove route from map
    if (routeLayer) {
        map.removeLayer(routeLayer);
        routeLayer = null;
    }
    
    // Reset destination display
    const destCard = document.getElementById('destinationCard');
    destCard.innerHTML = '<p class="no-destination">Set a destination to begin</p>';
    
    // Hide clear button
    document.getElementById('clearDestinationBtn').style.display = 'none';
    
    // Reset ETA display
    document.getElementById('etaDisplay').innerHTML = `
        <div class="eta-value">--</div>
        <div class="eta-label">minutes</div>
    `;
}

// Location Tracking
function startLocationTracking() {
    locationTracking = true;
    document.getElementById('toggleTrackingBtn').classList.add('active');
    
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                currentUser.location = { latitude, longitude };
                
                // Update own marker
                addUserMarker(currentUser.username, latitude, longitude, true);
                
                // Send location to server
                if (socket) {
                    socket.emit('locationUpdate', {
                        username: currentUser.username,
                        groupId: currentUser.groupId,
                        latitude,
                        longitude
                    });
                }
                
                // Calculate ETA if destination is set
                if (groupDestination) {
                    calculateRoute();
                }
            },
            (error) => {
                console.error('Location tracking error:', error);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 5000
            }
        );
    }
}

function toggleLocationTracking() {
    if (locationTracking) {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
        }
        locationTracking = false;
        document.getElementById('toggleTrackingBtn').classList.remove('active');
        showAlert('Location tracking stopped', 'info');
    } else {
        startLocationTracking();
        showAlert('Location tracking started', 'success');
    }
}

// Route Calculation using Geoapify
async function calculateRoute() {
    if (!currentUser.location || !groupDestination) return;
    
    try {
        const response = await fetch(
            `https://api.geoapify.com/v1/routing?waypoints=${currentUser.location.latitude},${currentUser.location.longitude}|${groupDestination.latitude},${groupDestination.longitude}&mode=drive&apiKey=${GEOAPIFY_API_KEY}`
        );
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
            const route = data.features[0];
            const duration = Math.round(route.properties.time / 60); // Convert to minutes
            const distance = (route.properties.distance / 1000).toFixed(2); // Convert to km
            
            // Update ETA display
            document.getElementById('etaDisplay').innerHTML = `
                <div class="eta-value">${duration}</div>
                <div class="eta-label">minutes (${distance} km)</div>
            `;
            
            // Send ETA to server
            if (socket) {
                socket.emit('locationUpdate', {
                    username: currentUser.username,
                    groupId: currentUser.groupId,
                    latitude: currentUser.location.latitude,
                    longitude: currentUser.location.longitude,
                    eta: duration
                });
            }
            
            // Draw route on map
            if (routeLayer) {
                map.removeLayer(routeLayer);
            }
            
            const coordinates = route.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
            routeLayer = L.polyline(coordinates, {
                color: '#4F46E5',
                weight: 4,
                opacity: 0.7
            }).addTo(map);
        }
    } catch (error) {
        console.error('Error calculating route:', error);
    }
}

// Map Functions
function addUserMarker(username, lat, lng, isSelf = false) {
    const markerId = username;
    
    if (userMarkers[markerId]) {
        userMarkers[markerId].setLatLng([lat, lng]);
    } else {
        const icon = L.divIcon({
            className: 'custom-marker',
            html: `<div style="background: ${isSelf ? '#4F46E5' : '#10B981'}; color: white; padding: 5px 10px; border-radius: 15px; font-weight: bold; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${username}</div>`,
            iconSize: [100, 40],
            iconAnchor: [50, 20]
        });
        
        userMarkers[markerId] = L.marker([lat, lng], { icon }).addTo(map);
    }
}

function removeUserMarker(username) {
    if (userMarkers[username]) {
        map.removeLayer(userMarkers[username]);
        delete userMarkers[username];
    }
}

function addDestinationMarker(lat, lng) {
    if (destinationMarker) {
        destinationMarker.setLatLng([lat, lng]);
    } else {
        const icon = L.divIcon({
            className: 'destination-marker',
            html: '<div style="background: #EF4444; color: white; padding: 10px; border-radius: 50%; font-size: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">📍</div>',
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        });
        
        destinationMarker = L.marker([lat, lng], { icon }).addTo(map);
    }
    
    // Fit map to show all markers
    const bounds = L.latLngBounds([]);
    if (currentUser.location) {
        bounds.extend([currentUser.location.latitude, currentUser.location.longitude]);
    }
    bounds.extend([lat, lng]);
    map.fitBounds(bounds, { padding: [50, 50] });
}

function centerMap() {
    if (currentUser.location) {
        map.setView([currentUser.location.latitude, currentUser.location.longitude], 13);
    }
}

function fitMapToMarkers() {
    const bounds = L.latLngBounds([]);
    let hasMarkers = false;
    
    // Add all user markers to bounds
    Object.values(userMarkers).forEach(marker => {
        bounds.extend(marker.getLatLng());
        hasMarkers = true;
    });
    
    // Add destination marker if exists
    if (destinationMarker) {
        bounds.extend(destinationMarker.getLatLng());
        hasMarkers = true;
    }
    
    // Fit map to bounds if we have markers
    if (hasMarkers) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }
}

async function suggestMeetingPoint() {
    if (!currentUser.groupId) {
        showAlert('Join a group first', 'warning');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${currentUser.groupId}`);
        const users = await response.json();
        
        if (users.length < 2) {
            showAlert('Need at least 2 members online to suggest meeting point', 'info');
            return;
        }
        
        // Calculate centroid
        let totalLat = 0, totalLng = 0, count = 0;
        users.forEach(user => {
            if (user.currentLocation) {
                totalLat += user.currentLocation.latitude;
                totalLng += user.currentLocation.longitude;
                count++;
            }
        });
        
        if (count === 0) {
            showAlert('No location data available', 'warning');
            return;
        }
        
        const centerLat = totalLat / count;
        const centerLng = totalLng / count;
        
        // Get address for meeting point
        const geoResponse = await fetch(
            `https://api.geoapify.com/v1/geocode/reverse?lat=${centerLat}&lon=${centerLng}&apiKey=${GEOAPIFY_API_KEY}`
        );
        const geoData = await geoResponse.json();
        const address = geoData.features[0]?.properties.formatted || 'Unknown location';
        
        // Add marker for meeting point
        const icon = L.divIcon({
            className: 'meeting-marker',
            html: '<div style="background: #F59E0B; color: white; padding: 10px; border-radius: 50%; font-size: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">🤝</div>',
            iconSize: [50, 50],
            iconAnchor: [25, 25]
        });
        
        L.marker([centerLat, centerLng], { icon })
            .addTo(map)
            .bindPopup(`<strong>Suggested Meeting Point</strong><br>${address}`)
            .openPopup();
        
        map.setView([centerLat, centerLng], 13);
        showAlert(`Meeting point suggested: ${address}`, 'success');
    } catch (error) {
        console.error('Error suggesting meeting point:', error);
        showAlert('Failed to calculate meeting point', 'danger');
    }
}

// UI Update Functions
function updateGroupDisplay(group) {
    document.getElementById('usernameDisplay').textContent = currentUser.username;
    
    const groupCard = document.getElementById('groupCard');
    groupCard.innerHTML = `
        <p><strong>Group:</strong> ${group.groupName}</p>
        <p><strong>ID:</strong> ${group.groupId}</p>
        <p><strong>Members:</strong> ${group.members.length}</p>
    `;
}

function updateDestinationDisplay(destination) {
    const destCard = document.getElementById('destinationCard');
    destCard.innerHTML = `
        <p><strong>📍 ${destination.address || 'Destination Set'}</strong></p>
        <p><small>${destination.latitude.toFixed(6)}, ${destination.longitude.toFixed(6)}</small></p>
    `;
    
    // Show clear button when destination is set
    document.getElementById('clearDestinationBtn').style.display = 'block';
}

function updateMembersList(members) {
    const membersList = document.getElementById('membersList');
    const memberCount = document.getElementById('memberCount');
    
    memberCount.textContent = `(${members.length})`;
    
    if (members.length === 0) {
        membersList.innerHTML = '<p class="no-members">No members online</p>';
        return;
    }
    
    membersList.innerHTML = '';
    members.forEach(member => {
        if (!member.isOnline) return;
        
        const memberItem = document.createElement('div');
        memberItem.className = `member-item ${member.username === currentUser.username ? 'self' : ''}`;
        memberItem.innerHTML = `
            <div class="member-name">
                <span class="member-status"></span>
                <span>${member.username}${member.username === currentUser.username ? ' (You)' : ''}</span>
            </div>
            <span class="member-eta">${member.eta ? member.eta + ' min' : '--'}</span>
        `;
        membersList.appendChild(memberItem);
    });
}

function updateMemberETA(username, eta) {
    // This will be updated when we refresh members list
}

// Alert System
function showAlert(message, type = 'info') {
    const alertsPanel = document.getElementById('alertsPanel');
    
    const iconMap = {
        success: '✅',
        danger: '⚠️',
        warning: '⏰',
        info: 'ℹ️'
    };
    
    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.innerHTML = `
        <span class="alert-icon">${iconMap[type]}</span>
        <span>${message}</span>
    `;
    
    alertsPanel.appendChild(alert);
    
    setTimeout(() => {
        alert.style.animation = 'slideUp 0.3s ease reverse';
        setTimeout(() => alert.remove(), 300);
    }, 5000);
}

// Modal Functions
function showModal(modalId) {
    document.getElementById(modalId).classList.remove('hidden');
}

function hideModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
}

function showWelcomeModal() {
    showModal('welcomeModal');
}
