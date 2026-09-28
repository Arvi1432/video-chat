const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

// Public folder se static files serve karne ke liye
app.use(express.static(path.join(__dirname, '../public')));

// Users ka naam store karne ke liye ek object
const users = {};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Jab naya user apna naam set kare
    socket.on('new-user-joined', (username) => {
        users[socket.id] = username;
        // Baaki sabhi ko batayein ki kaun juda hai
        socket.broadcast.emit('system-message', `${username} has joined the chat.`);
    });

    // ==========================================================================
    // 1. CHAT LOGIC (Naam ke sath message bhejna)
    // ==========================================================================
    socket.on('chat-message', (msg) => {
        const senderName = users[socket.id] || "Friend";
        socket.broadcast.emit('chat-message', { sender: senderName, message: msg });
    });

    // ==========================================================================
    // 2. VIDEO CALLING LOGIC (WebRTC Signaling)
    // ==========================================================================
    socket.on('call-offer', (offer) => {
        socket.broadcast.emit('call-offer', offer);
    });

    socket.on('call-answer', (answer) => {
        socket.broadcast.emit('call-answer', answer);
    });

    socket.on('ice-candidate', (candidate) => {
        socket.broadcast.emit('ice-candidate', candidate);
    });

    socket.on('hangup', () => {
        socket.broadcast.emit('hangup');
    });

    // ==========================================================================
    // 3. REAL-TIME LOCATION LOGIC
    // ==========================================================================
    socket.on('request-location-share', () => {
        const requesterName = users[socket.id] || "Your friend";
        socket.broadcast.emit('location-request-received', requesterName);
    });

    socket.on('sharing-live-location', (data) => {
        const senderName = users[socket.id] || "Friend";
        socket.broadcast.emit('live-location-update', { ...data, name: senderName });
    });

    socket.on('location-request-denied', () => {
        const denierName = users[socket.id] || "Your friend";
        socket.broadcast.emit('friend-denied-location', denierName);
    });

    // Disconnect handler
    socket.on('disconnect', () => {
        if (users[socket.id]) {
            socket.broadcast.emit('system-message', `${users[socket.id]} has left the chat.`);
            delete users[socket.id];
        }
    });
});

http.listen(PORT, () => {
    console.log(`Server running on: http://localhost:${PORT}`);
});