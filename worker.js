const MAX_FILE_BYTES = 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8;

const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
});

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return json({ ok: true });
        }

        if (url.pathname === '/ws') {
            const upgrade = request.headers.get('Upgrade') || '';
            if (upgrade.toLowerCase() !== 'websocket') {
                return json({ error: 'expected websocket upgrade' }, 400);
            }

            const hub = env.HUB.get(env.HUB.idFromName('global'));
            return hub.fetch(request);
        }

        return env.ASSETS.fetch(request);
    }
};

function cleanRoomId(value) {
    return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'default';
}

export class Hub {
    constructor(state) {
        this.state = state;
        this.sessions = new Map();
        this.rooms = new Map();
        this.counter = 0;
    }

    async fetch(request) {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();

        const id = `${Date.now().toString(36)}-${(this.counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const user = { id, name: 'Device', role: 'standby', roomId: null };
        this.sessions.set(server, user);

        this.send(server, 'welcome', { id });

        server.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            this.handle(server, user, message.type, message.data || {});
        });

        const close = () => {
            this.leaveRoom(server, user);
            this.sessions.delete(server);
        };
        server.addEventListener('close', close);
        server.addEventListener('error', close);

        return new Response(null, { status: 101, webSocket: client });
    }

    handle(socket, user, type, data) {
        if (type === 'join-room') {
            this.joinRoom(socket, user, data.roomId, data.deviceName, data.role);
            return;
        }

        if (type === 'update-role') {
            if (data.roomId && cleanRoomId(data.roomId) !== user.roomId) return;
            const role = data.role === 'sender' || data.role === 'receiver' ? data.role : 'standby';
            user.role = role;
            this.broadcastRoomUsers(user.roomId);
            return;
        }

        if (type === 'send-file') {
            if (data.roomId && cleanRoomId(data.roomId) !== user.roomId) return;
            const fileData = String(data.fileData || '');
            if (fileData.length > MAX_BASE64_CHARS) {
                this.send(socket, 'app-error', `File "${String(data.fileName || 'tanpa nama')}" terlalu besar. Maksimal 1 MB per file.`);
                return;
            }

            const payload = {
                fileId: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                fileName: String(data.fileName || 'file').slice(0, 200),
                fileType: String(data.fileType || 'application/octet-stream').slice(0, 100),
                fileSize: Number(data.fileSize) || 0,
                fileData,
                senderName: user.name,
                timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            };
            this.deliver(socket, user, data.targetId, 'receive-file', payload);
            return;
        }

        if (type === 'send-text') {
            if (data.roomId && cleanRoomId(data.roomId) !== user.roomId) return;
            const payload = {
                text: String(data.text || '').slice(0, 8000),
                senderName: user.name,
                timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            };
            if (!payload.text) return;
            this.deliver(socket, user, data.targetId, 'receive-text', payload);
        }
    }

    joinRoom(socket, user, roomId, deviceName, role) {
        const nextRoom = cleanRoomId(roomId);
        if (user.roomId === nextRoom) {
            user.name = String(deviceName || user.name).slice(0, 40);
            user.role = role === 'sender' || role === 'receiver' ? role : user.role;
            this.broadcastRoomUsers(nextRoom);
            return;
        }

        this.leaveRoom(socket, user);
        user.roomId = nextRoom;
        user.name = String(deviceName || user.name).slice(0, 40);
        user.role = role === 'sender' || role === 'receiver' ? role : 'standby';

        if (!this.rooms.has(nextRoom)) this.rooms.set(nextRoom, new Map());
        this.rooms.get(nextRoom).set(socket, user);
        this.broadcastRoomUsers(nextRoom);
    }

    leaveRoom(socket, user, shouldBroadcast = true) {
        const roomId = user.roomId;
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (room) {
            room.delete(socket);
            if (room.size === 0) this.rooms.delete(roomId);
        }
        user.roomId = null;
        if (shouldBroadcast) this.broadcastRoomUsers(roomId);
    }

    deliver(sender, senderUser, targetId, type, payload) {
        if (targetId && targetId !== 'all') {
            for (const [socket, user] of this.sessions) {
                if (user.id === targetId && user.roomId === senderUser.roomId) {
                    this.send(socket, type, payload);
                }
            }
            return;
        }

        const room = this.rooms.get(senderUser.roomId);
        if (!room) return;
        for (const socket of room.keys()) {
            if (socket !== sender) this.send(socket, type, payload);
        }
    }

    broadcastRoomUsers(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return;
        const users = Array.from(room.values(), ({ id, name, role }) => ({ id, name, role }));
        for (const socket of room.keys()) {
            this.send(socket, 'room-users-updated', users);
        }
    }

    send(socket, type, data) {
        try {
            socket.send(JSON.stringify({ type, data }));
        } catch {
            // Sesi dibersihkan oleh handler close/error.
        }
    }
}
