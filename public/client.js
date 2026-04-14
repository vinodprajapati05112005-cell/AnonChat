// client.js - AnonChat

const socket = io();

// ===== PERSISTENT CODE =====
// Each user gets a permanent 6-char code stored in localStorage
function getOrCreateCode() {
  let code = localStorage.getItem('anonchat_code');
  if (!code || code.length !== 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    localStorage.setItem('anonchat_code', code);
  }
  return code;
}

const MY_CODE = getOrCreateCode();

// ===== STATE =====
let mySocketId = null;
let currentRoom = null;
let friendConnected = false;

// ===== DOM =====
const homeScreen   = document.getElementById('home-screen');
const chatScreen   = document.getElementById('chat-screen');
const myCodeEl     = document.getElementById('my-code');
const copyBtn      = document.getElementById('copy-btn');
const joinInput    = document.getElementById('join-input');
const joinBtn      = document.getElementById('join-btn');
const viewRoomsBtn = document.getElementById('view-rooms-btn');
const roomsPanel   = document.getElementById('rooms-panel');
const closeRoomsBtn= document.getElementById('close-rooms-btn');
const roomsList    = document.getElementById('rooms-list');
const recentSection = document.getElementById('recent-section');
const recentCodesEl = document.getElementById('recent-codes');
const clearRecentBtn = document.getElementById('clear-recent-btn');

const statusBar    = document.getElementById('status-bar');
const chatRoomCode = document.getElementById('chat-room-code');
const chatCopyBtn  = document.getElementById('chat-copy-btn');
const newChatBtn   = document.getElementById('new-chat-btn');
const messagesEl   = document.getElementById('messages');
const msgInput     = document.getElementById('msg-input');
const sendBtn      = document.getElementById('send-btn');
const imgInput     = document.getElementById('img-input');
const emojiBtn     = document.getElementById('emoji-btn');
const emojiPanel   = document.getElementById('emoji-panel');
const toast        = document.getElementById('toast');

// ===== INIT =====
myCodeEl.textContent = MY_CODE;

const RECENT_KEY = 'anonchat_recent_codes';
const RECENT_LIMIT = 8;

renderRecentCodes();
clearRecentBtn.addEventListener('click', clearRecentCodes);

// ===== VIEWPORT HEIGHT FIX (MOBILE) =====
function setAppHeight() {
  document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
}
setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setAppHeight);
}

// Block right-click (prevent image save via context menu)
document.addEventListener('contextmenu', e => e.preventDefault());

// Block drag-out of images
document.addEventListener('dragstart', e => e.preventDefault());

// ===== SCREENSHOT DETERRENTS =====

// 1. Blur chat content when window loses focus (tab switch, alt-tab, snipping tool)
const blurOverlay = document.createElement('div');
blurOverlay.id = 'blur-overlay';
blurOverlay.innerHTML = '<div class="blur-msg">Chat hidden while away</div>';
document.body.appendChild(blurOverlay);

window.addEventListener('blur', () => {
  // Only blur when in chat screen
  if (chatScreen.classList.contains('active')) {
    blurOverlay.classList.add('visible');
  }
});
window.addEventListener('focus', () => {
  blurOverlay.classList.remove('visible');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && chatScreen.classList.contains('active')) {
    blurOverlay.classList.add('visible');
  } else {
    blurOverlay.classList.remove('visible');
  }
});

// 2. Watermark -- room code + timestamp burned into chat area
//    Updated whenever a message is added, so it's always visible in screenshots
function updateWatermark() {
  let wm = document.getElementById('chat-watermark');
  if (!wm) {
    wm = document.createElement('div');
    wm.id = 'chat-watermark';
    // Insert as last child of chat-wrapper so it covers the whole area
    const wrapper = document.querySelector('.chat-wrapper');
    if (wrapper) wrapper.appendChild(wm);
  }
  if (!chatScreen.classList.contains('active')) {
    wm.innerHTML = '';
    return;
  }
  const now = new Date().toLocaleString();
  const stamp = `ROOM ${currentRoom || '------'} | ${now}`;
  const items = wm.querySelectorAll('.wm-item');
  if (!items.length) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 12; i += 1) {
      const span = document.createElement('span');
      span.className = 'wm-item';
      span.textContent = stamp;
      frag.appendChild(span);
    }
    wm.appendChild(frag);
    return;
  }
  items.forEach(item => {
    item.textContent = stamp;
  });
}

let watermarkTimer = null;
function startWatermarkTimer() {
  if (watermarkTimer) return;
  watermarkTimer = setInterval(() => {
    if (chatScreen.classList.contains('active')) updateWatermark();
  }, 2000);
}
startWatermarkTimer();

// ===== EMOJI SETUP =====
const EMOJIS = [
  '\u{1F600}','\u{1F602}','\u{1F60D}','\u{1F970}','\u{1F60E}','\u{1F62D}','\u{1F605}','\u{1F914}','\u{1F60F}','\u{1F97A}',
  '\u{1F60A}','\u{1F923}','\u{1F607}','\u{1F929}','\u{1F61C}','\u{1F624}','\u{1F92F}','\u{1F634}','\u{1F973}','\u{1F62C}',
  '\u{1F44D}','\u{1F44E}','\u2764\uFE0F','\u{1F525}','\u2728','\u{1F389}','\u{1F4AF}','\u{1F44F}','\u{1F64C}','\u{1F4AA}',
  '\u{1F91D}','\u{1F440}','\u{1F480}','\u{1FAE1}','\u{1F90C}','\u{1FAF6}','\u{1F494}','\u{1F608}','\u{1F47B}','\u{1F916}',
  '\u{1F436}','\u{1F431}','\u{1F98A}','\u{1F438}','\u{1F981}','\u{1F43C}','\u{1F984}','\u{1F419}','\u{1F98B}','\u{1F338}',
  '\u{1F355}','\u{1F354}','\u{1F35F}','\u{1F32E}','\u{1F35C}','\u{1F363}','\u{1F369}','\u{1F366}','\u2615','\u{1F9CB}'
];

EMOJIS.forEach(em => {
  const span = document.createElement('span');
  span.textContent = em;
  span.setAttribute('role', 'button');
  span.setAttribute('aria-label', em);
  span.addEventListener('click', () => {
    msgInput.value += em;
    msgInput.focus();
  });
  emojiPanel.appendChild(span);
});

emojiBtn.addEventListener('click', () => {
  emojiPanel.classList.toggle('hidden');
});

// Close emoji panel when clicking outside
document.addEventListener('click', (e) => {
  if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) {
    emojiPanel.classList.add('hidden');
  }
});

// ===== SOCKET EVENTS =====

socket.on('connect', () => {
  mySocketId = socket.id;
  // Auto-register into own permanent room on connect/reconnect
  socket.emit('register_code', MY_CODE);
});

socket.on('joined_room', (code) => {
  currentRoom = code;
  chatRoomCode.textContent = code;
  friendConnected = false;

  setStatus('waiting', 'Waiting for friend...');
  enableInput(false);
  messagesEl.innerHTML = '';
  addSystemMsg('Share your code with a friend, or wait for them to join.');
  updateWatermark();

  const isOwnRoom = code === MY_CODE;
  if (!isOwnRoom || chatScreen.classList.contains('active')) {
    showScreen('chat');
  }
});

socket.on('friend_joined', () => {
  friendConnected = true;
  setStatus('connected', 'Connected');
  enableInput(true);
  addSystemMsg('Friend joined. Start chatting!');
  if (homeScreen.classList.contains('active')) {
    showScreen('chat');
  }
  updateWatermark();
});

socket.on('receive_message', (payload) => {
  const isMine = payload.senderId === mySocketId;
  if (payload.type === 'image') {
    addImageBubble(payload.dataUrl, payload.name, isMine, payload.time);
  } else {
    addTextBubble(payload.text, isMine, payload.time);
  }
});

// Server confirmed we left -- go back to home screen
socket.on('left_room', () => {
  currentRoom = null;
  friendConnected = false;
  showScreen('home');
  // Re-register into own waiting room so the home screen reflects reality
  socket.emit('register_code', MY_CODE);
});

socket.on('friend_left', () => {
  friendConnected = false;
  setStatus('offline', 'Friend left');
  enableInput(false);
  addSystemMsg('Your friend left. Returning to your room...');
  // Re-register into own waiting room after a short delay
  setTimeout(() => socket.emit('register_code', MY_CODE), 2000);
});

socket.on('friend_offline', () => {
  friendConnected = false;
  setStatus('offline', 'Friend is offline');
  enableInput(false);
  addSystemMsg('Your friend disconnected. Returning to your room...');
  setTimeout(() => socket.emit('register_code', MY_CODE), 2000);
});

socket.on('room_full', () => showToast('Room is full (max 2 users).'));
socket.on('room_not_found', () => showToast('Room not found. Check the code.'));
socket.on('invalid_code', () => showToast('Invalid code.'));
socket.on('image_too_large', () => showToast('Image too large (max 5MB).'));

socket.on('active_rooms', (rooms) => renderRoomsList(rooms));

// ===== HOME ACTIONS =====

copyBtn.addEventListener('click', () => copyToClipboard(MY_CODE));

joinBtn.addEventListener('click', joinWithInput);
joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinWithInput(); });

function joinWithInput() {
  const didJoin = joinWithCode(joinInput.value);
  if (didJoin) joinInput.value = '';
}

viewRoomsBtn.addEventListener('click', () => {
  roomsPanel.classList.toggle('hidden');
  if (!roomsPanel.classList.contains('hidden')) socket.emit('request_rooms');
});
closeRoomsBtn.addEventListener('click', () => roomsPanel.classList.add('hidden'));

function normalizeCodeInput(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function joinWithCode(code) {
  const normalized = normalizeCodeInput(code);
  if (normalized.length !== 6) { showToast('Enter a valid 6-character code.'); return false; }
  if (normalized === MY_CODE) { showToast("That's your own code!"); return false; }
  addRecentCode(normalized);
  socket.emit('join_room', normalized);
  return true;
}

function loadRecentCodes() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(code => normalizeCodeInput(code))
      .filter(code => code.length === 6 && code !== MY_CODE);
  } catch (err) {
    return [];
  }
}

function saveRecentCodes(list) {
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

function addRecentCode(code) {
  if (!code || code === MY_CODE) return;
  const list = loadRecentCodes().filter(item => item !== code);
  list.unshift(code);
  saveRecentCodes(list.slice(0, RECENT_LIMIT));
  renderRecentCodes();
}

function clearRecentCodes() {
  saveRecentCodes([]);
  renderRecentCodes();
}

function renderRecentCodes() {
  const list = loadRecentCodes();
  recentCodesEl.innerHTML = '';
  if (!list.length) {
    recentSection.classList.add('hidden');
    return;
  }
  recentSection.classList.remove('hidden');
  list.forEach(code => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-code-btn';
    btn.textContent = code;
    btn.addEventListener('click', () => joinWithCode(code));
    recentCodesEl.appendChild(btn);
  });
}

// ===== CHAT ACTIONS =====

chatCopyBtn.addEventListener('click', () => copyToClipboard(currentRoom));

newChatBtn.addEventListener('click', () => {
  socket.emit('leave_room');
});

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !currentRoom || !friendConnected) return;
  socket.emit('send_message', text);
  msgInput.value = '';
  msgInput.focus();
  emojiPanel.classList.add('hidden');
}

// Image upload
imgInput.addEventListener('change', () => {
  const file = imgInput.files[0];
  if (!file) return;
  if (!friendConnected) { showToast('Wait for your friend to connect first.'); return; }
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5MB).'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    socket.emit('send_image', { dataUrl: e.target.result, name: file.name });
  };
  reader.readAsDataURL(file);
  imgInput.value = ''; // reset so same file can be sent again
});

// ===== HELPERS =====

function showScreen(name) {
  homeScreen.classList.remove('active');
  chatScreen.classList.remove('active');
  document.getElementById(name + '-screen').classList.add('active');
  updateWatermark();
}

function setStatus(type, text) {
  statusBar.className = `status ${type}`;
  statusBar.textContent = text;
}

function enableInput(on) {
  msgInput.disabled = !on;
  sendBtn.disabled = !on;
  if (on) msgInput.focus();
}

msgInput.addEventListener('focus', () => {
  setAppHeight();
  setTimeout(scrollBottom, 50);
});

function addTextBubble(text, isMine, time) {
  const row = document.createElement('div');
  row.className = `bubble-row ${isMine ? 'sent' : 'recv'}`;
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = `${escapeHtml(text)}<span class="time">${time}</span>`;
  row.appendChild(b);
  messagesEl.appendChild(row);
  scrollBottom();
  updateWatermark();
}

function addImageBubble(dataUrl, name, isMine, time) {
  const row = document.createElement('div');
  row.className = `bubble-row ${isMine ? 'sent' : 'recv'}`;
  const b = document.createElement('div');
  b.className = 'bubble';

  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = name || 'image';
  img.draggable = false; // prevent drag-save
  // Prevent right-click on image specifically
  img.addEventListener('contextmenu', e => e.preventDefault());

  const dlBtn = document.createElement('button');
  dlBtn.className = 'img-download-btn';
  dlBtn.innerHTML = 'Download';
  dlBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name || 'image.png';
    a.click();
  });

  const timeEl = document.createElement('span');
  timeEl.className = 'time';
  timeEl.textContent = time;

  b.appendChild(img);
  b.appendChild(dlBtn);
  b.appendChild(timeEl);
  row.appendChild(b);
  messagesEl.appendChild(row);
  scrollBottom();
}

function addSystemMsg(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  messagesEl.appendChild(el);
  scrollBottom();
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text)
    .then(() => showToast('Code copied!'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Code copied!');
    });
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderRoomsList(rooms) {
  roomsList.innerHTML = '';
  if (!Array.isArray(rooms) || !rooms.length) {
    roomsList.innerHTML = '<li class="no-rooms">No one waiting right now.</li>';
    return;
  }
  rooms.forEach(({ code }) => {
    // Don't show own room in the list
    if (code === MY_CODE) return;
    const li = document.createElement('li');
    li.innerHTML = `<span class="room-code-item">${code}</span>`;
    const btn = document.createElement('button');
    btn.className = 'room-join-btn';
    btn.textContent = 'Join';
    btn.addEventListener('click', () => {
      roomsPanel.classList.add('hidden');
      addRecentCode(code);
      socket.emit('join_room', code);
    });
    li.appendChild(btn);
    roomsList.appendChild(li);
  });
  // If all rooms were own room, show empty
  if (!roomsList.children.length) {
    roomsList.innerHTML = '<li class="no-rooms">No one waiting right now.</li>';
  }
}
