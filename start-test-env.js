const { spawn } = require('child_process');

console.log('🚀 Starting Test Environment...');

// 1. Start App Server (Port 5000)
const appServer = spawn('npx', ['http-server', 'public', '-p', '5000', '-c-1'], { shell: true, stdio: 'inherit' });

// 2. Start PeerJS Signaling Server (Port 9000)
// path: /myapp ensures we match the client config
const peerServer = spawn('npx', ['peerjs', '--port', '9000', '--path', '/myapp'], { shell: true, stdio: 'inherit' });

console.log('✅ Servers Launching: Web:5000, Peer:9000');

// Handle exit
process.on('SIGINT', () => {
    appServer.kill();
    peerServer.kill();
    process.exit();
});
