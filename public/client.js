const socket = io();

// DOM Elements
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const openCamBtn = document.getElementById('open-cam-btn');
const stopCamBtn = document.getElementById('stop-cam-btn');
const sendMsgBtn = document.getElementById('send-msg-btn');
const messageInput = document.getElementById('message-input');
const chatBox = document.getElementById('chat-box');
const locationBtn = document.getElementById('request-location-btn');

let localStream;
let peerConnection;
let map, marker;
let myName = "";

// Name Prompt Popup
while (!myName || myName.trim() === "") {
    myName = prompt("Enter your name to join:");
}
socket.emit('new-user-joined', myName);

// WebRTC Configuration
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// Map Initialization
map = L.map('map').setView([20.5937, 78.9629], 5); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Video / Audio Stream Access with Fallback Handling
openCamBtn.addEventListener('click', async () => {
    try {
        // Pehle full Video + Audio request karein
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        await startWebRTCPeer();
    } catch (err) {
        console.warn("Camera blocked by system. Switching to Audio-Only fallback mode...", err);
        
        try {
            // FALLBACK: Agar camera hardware blocked hai, toh sirf audio chalu karein taki connection ban jaye
            localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
            localVideo.srcObject = localStream;
            await startWebRTCPeer();
            appendSystemMessage("Connected via Audio-Only (Camera was busy or blocked by system).");
        } catch (audioErr) {
            console.error("Audio also blocked:", audioErr);
            alert("System ne Camera aur Mic dono block kiye hain! Kripya Windows Settings check karein.");
        }
    }
});

async function startWebRTCPeer() {
    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) socket.emit('ice-candidate', event.candidate);
    };

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call-offer', offer);
    appendSystemMessage("Starting call / Waiting for peer...");
}

stopCamBtn.addEventListener('click', () => {
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (peerConnection) peerConnection.close();
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    socket.emit('hangup');
    appendSystemMessage("You left the call.");
});

// WebRTC Signaling Events
socket.on('call-offer', async (offer) => {
    if (!peerConnection) {
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.ontrack = (event) => { remoteVideo.srcObject = event.streams[0]; };
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) socket.emit('ice-candidate', event.candidate);
        };
    }
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    
    if (!localStream) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (e) {
            localStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
        }
        localVideo.srcObject = localStream;
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
    }

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call-answer', answer);
});

socket.on('call-answer', async (answer) => {
    if (peerConnection) await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice-candidate', async (candidate) => {
    if (peerConnection) {
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
});

socket.on('hangup', () => {
    if (peerConnection) peerConnection.close();
    remoteVideo.srcObject = null;
    appendSystemMessage("Remote user left the call.");
});

// Chat Code
sendMsgBtn.addEventListener('click', sendTextMessage);
messageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendTextMessage(); });

function sendTextMessage() {
    const message = messageInput.value.trim();
    if (message) {
        socket.emit('chat-message', message);
        appendUserMessage("You", message);
        messageInput.value = '';
    }
}

socket.on('chat-message', (data) => { appendUserMessage(data.sender, data.message); });
socket.on('system-message', (msg) => { appendSystemMessage(msg); });

function appendUserMessage(sender, msg) {
    const msgElement = document.createElement('div');
    msgElement.style.margin = '5px 0';
    msgElement.innerHTML = `<strong>${sender}:</strong> ${msg}`;
    chatBox.appendChild(msgElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendSystemMessage(msg) {
    const msgElement = document.createElement('div');
    msgElement.className = 'message system';
    msgElement.innerText = msg;
    chatBox.appendChild(msgElement);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// Live Location Code with Connection Checker
locationBtn.addEventListener('click', () => {
    if (!peerConnection || peerConnection.connectionState === "disconnected") {
        alert("Pehle 'Join Call' karke audio/video connection banayein!");
        return;
    }
    socket.emit('request-location-share');
    appendSystemMessage("Location request sent...");
});

socket.on('location-request-received', (requesterName) => {
    const allow = confirm(`${requesterName} wants to see your live location. Allow?`);
    if (allow) {
        if (navigator.geolocation) {
            navigator.geolocation.watchPosition((position) => {
                socket.emit('sharing-live-location', { latitude: position.coords.latitude, longitude: position.coords.longitude });
            }, (error) => console.error(error), { enableHighAccuracy: true });
        }
    } else {
        socket.emit('location-request-denied');
    }
});

socket.on('live-location-update', (data) => {
    const { latitude, longitude, name } = data;
    if (marker) {
        marker.setLatLng([latitude, longitude]);
        marker.setPopupContent(`<b>${name} is Here Live</b>`);
    } else {
        marker = L.marker([latitude, longitude]).addTo(map);
        marker.bindPopup(`<b>${name} is Here Live</b>`).openPopup();
    }
    map.setView([latitude, longitude], 16);
    appendSystemMessage(`${name}'s live location updated.`);
});

socket.on('friend-denied-location', (denierName) => {
    alert(`${denierName} has denied the location request.`);
});