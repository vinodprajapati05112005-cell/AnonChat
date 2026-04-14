// server.js - AnonChat Server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 8 * 1024 * 1024
});

const MAX_MESSAGE_LENGTH = 500;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/health', (_req, res) => res.status(200).send('ok'));

// rooms: { code: { users: [socketId, ...] } }
const rooms = {};

function normalizeCode(raw) {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 6) return null;
  return cleaned;
}

function sanitizeMessage(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  return text.length > MAX_MESSAGE_LENGTH ? text.slice(0, MAX_MESSAGE_LENGTH) : text;
}

function getDataUrlByteLength(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const parts = dataUrl.split(',');
  if (parts.length < 2) return 0;
  const base64 = parts[1];
  const paddingMatch = base64.match(/=*$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function ensureRoom(code) {
  if (!rooms[code]) rooms[code] = { users: [] };
}

function joinRoom(socket, code) {
  ensureRoom(code);
  if (!rooms[code].users.includes(socket.id)) {
    rooms[code].users.push(socket.id);
  }
  socket.join(code);
  socket.data.room = code;
}

function tryJoinFallback(socket) {
  const fallbackCode = socket.data.code;
  if (!fallbackCode) return;
  ensureRoom(fallbackCode);
  if (rooms[fallbackCode].users.length >= 2) return;
  joinRoom(socket, fallbackCode);
  socket.emit('joined_room', fallbackCode);
  if (rooms[fallbackCode].users.length === 2) io.to(fallbackCode).emit('friend_joined');
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // User arrives with their permanent code -- auto-join their own room
  socket.on('register_code', (code) => {
    const c = normalizeCode(code);
    if (!c) {
      socket.emit('invalid_code');
      return;
    }

    // Leave current room first, THEN (re)create own room
    leaveCurrentRoom(socket, 'friend_left');

    ensureRoom(c);
    if (rooms[c].users.length >= 2) {
      socket.emit('room_full');
      return;
    }

    joinRoom(socket, c);
    socket.data.code = c;

    socket.emit('joined_room', c);
    if (rooms[c].users.length === 2) io.to(c).emit('friend_joined');

    broadcastRooms();
  });

  // Join a friend's room by their code
  socket.on('join_room', (code) => {
    const c = normalizeCode(code);
    if (!c) { socket.emit('invalid_code'); return; }
    if (socket.data.room === c) { socket.emit('joined_room', c); return; }
    if (rooms[c] && rooms[c].users.length >= 2) { socket.emit('room_full'); return; }

    // Leave current room only after we know the target isn't full
    leaveCurrentRoom(socket, 'friend_left');

    ensureRoom(c);
    if (rooms[c].users.length >= 2) {
      socket.emit('room_full');
      tryJoinFallback(socket);
      broadcastRooms();
      return;
    }

    joinRoom(socket, c);

    socket.emit('joined_room', c);
    if (rooms[c].users.length === 2) io.to(c).emit('friend_joined');

    broadcastRooms();
  });

  // Text message
  socket.on('send_message', (text) => {
    const room = socket.data.room;
    if (!room) return;
    const safeText = sanitizeMessage(text);
    if (!safeText) return;
    io.to(room).emit('receive_message', {
      type: 'text',
      text: safeText,
      senderId: socket.id,
      time: new Date().toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit'
})
    });
  });

  // Image message (base64 data URL)
  socket.on('send_image', ({ dataUrl, name }) => {
    const room = socket.data.room;
    if (!room) return;
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    if (getDataUrlByteLength(dataUrl) > MAX_IMAGE_BYTES) {
      socket.emit('image_too_large');
      return;
    }
    io.to(room).emit('receive_message', {
      type: 'image',
      dataUrl,
      name,
      senderId: socket.id,
      time: new Date().toLocaleTimeString('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit'
})
    });
  });

  // Leave room -- just remove from current room, client goes back to home
  socket.on('leave_room', () => {
    leaveCurrentRoom(socket, 'friend_left');
    socket.emit('left_room');
    broadcastRooms();
  });

  // Request rooms list
  socket.on('request_rooms', () => socket.emit('active_rooms', buildRoomList()));

  socket.on('disconnect', () => {
    leaveCurrentRoom(socket, 'friend_offline');
    // Clean up own permanent room if empty
    const ownCode = socket.data.code;
    if (ownCode && rooms[ownCode] && rooms[ownCode].users.length === 0) {
      delete rooms[ownCode];
    }
    broadcastRooms();
  });

  function leaveCurrentRoom(socket, event) {
    const room = socket.data.room;
    if (!room || !rooms[room]) return;
    rooms[room].users = rooms[room].users.filter(id => id !== socket.id);
    socket.data.room = null;
    socket.leave(room);
    socket.to(room).emit(event);
    if (rooms[room].users.length === 0) {
      delete rooms[room];
    }
  }

  function buildRoomList() {
    return Object.entries(rooms)
      .filter(([, d]) => d.users.length === 1) // only waiting rooms (1 user)
      .map(([code, d]) => ({ code, users: d.users.length }));
  }

  function broadcastRooms() {
    io.emit('active_rooms', buildRoomList());
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server: http://localhost:${PORT}`));
