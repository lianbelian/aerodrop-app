const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e8
});

app.use(express.static(path.join(__dirname, 'public')));

const activeRooms = new Map();

io.on('connection', (socket) => {
    console.log(`[Connected] Device ID: ${socket.id}`);

    socket.on('join-room', ({ roomId, deviceName, role }) => {
        socket.join(roomId);
        socket.roomId = roomId;
        socket.deviceName = deviceName;
        socket.role = role || 'standby';

        if (!activeRooms.has(roomId)) {
            activeRooms.set(roomId, new Map());
        }
        activeRooms.get(roomId).set(socket.id, {
            id: socket.id,
            name: deviceName,
            role: socket.role
        });

        broadcastRoomUsers(roomId);
    });

    socket.on('update-role', ({ roomId, role }) => {
        if (activeRooms.has(roomId) && activeRooms.get(roomId).has(socket.id)) {
            const user = activeRooms.get(roomId).get(socket.id);
            user.role = role;
            socket.role = role;
            broadcastRoomUsers(roomId);
        }
    });

    socket.on('send-file', ({ roomId, fileName, fileType, fileSize, fileData, senderName, targetId }) => {
        const payload = {
            fileId: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            fileName,
            fileType,
            fileSize,
            fileData,
            senderName,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        if (targetId && targetId !== 'all') {
            io.to(targetId).emit('receive-file', payload);
        } else {
            // Kirim ke semua perangkat lain di room (termasuk yang baru masuk / sedang pilih peran)
            socket.to(roomId).emit('receive-file', payload);
        }
    });

    socket.on('send-text', ({ roomId, text, senderName, targetId }) => {
        const payload = {
            text,
            senderName,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };

        if (targetId && targetId !== 'all') {
            io.to(targetId).emit('receive-text', payload);
        } else {
            socket.to(roomId).emit('receive-text', payload);
        }
    });

    socket.on('disconnect', () => {
        const roomId = socket.roomId;
        if (roomId && activeRooms.has(roomId)) {
            const roomUsers = activeRooms.get(roomId);
            roomUsers.delete(socket.id);

            if (roomUsers.size === 0) {
                activeRooms.delete(roomId);
            } else {
                broadcastRoomUsers(roomId);
            }
        }
        console.log(`[Disconnected] Device ID: ${socket.id}`);
    });

    function broadcastRoomUsers(roomId) {
        if (!activeRooms.has(roomId)) return;
        const usersList = Array.from(activeRooms.get(roomId).values());
        io.to(roomId).emit('room-users-updated', usersList);
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server AeroDrop berjalan di http://localhost:${PORT}`);
});