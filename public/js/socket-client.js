let _socket = null;

function initSocket() {
  if (_socket) return _socket;
  _socket = io({ transports: ['websocket', 'polling'] });

  _socket.on('connect', () => {
    console.log('[Socket] Connected:', _socket.id);
  });
  _socket.on('disconnect', (reason) => {
    console.warn('[Socket] Disconnected:', reason);
  });
  _socket.on('connect_error', (err) => {
    console.error('[Socket] Error:', err.message);
  });

  return _socket;
}

function joinSection(sectionId) {
  if (!_socket) return;
  _socket.emit('join_section', sectionId);
}

function getSocket() { return _socket; }

window.initSocket  = initSocket;
window.joinSection = joinSection;
window.getSocket   = getSocket;
