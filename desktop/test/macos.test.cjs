const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(file, mocks, platform) {
  const context = {
    require: (name) => name in mocks ? mocks[name] : require(name),
    module: { exports: {} }, __dirname: path.join(__dirname, '..'),
    process: { platform, env: {} }, Buffer,
    setInterval: () => 1, clearInterval() {}, setTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  return context.module.exports;
}

for (const [platform, label] of [['darwin', 'macOS'], ['win32', 'Windows'], ['linux', 'Linux']]) {
  test(`LAN discovery advertises ${label} and accepts Android peers`, () => {
    const socket = new EventEmitter();
    let advertisement, peers;
    socket.bind = (_port, _host, callback) => callback();
    socket.setBroadcast = () => {};
    socket.send = (packet) => { advertisement = JSON.parse(packet); };
    socket.close = () => {};
    const { Discovery } = load('discovery.cjs', {
      'node:dgram': { createSocket: () => socket },
      'node:os': { networkInterfaces: () => ({}) },
    }, platform);
    const discovery = new Discovery('desktop-id', 'Desktop', 12345, (value) => { peers = value; }, assert.fail);
    assert.equal(advertisement.platform, label);
    socket.emit('message', Buffer.from(JSON.stringify({ magic: 'edgebeam', v: 1, id: 'phone-id', name: 'Phone', platform: 'Android', port: 12346 })), { address: '192.168.1.2' });
    assert.equal(peers.length, 1);
    assert.equal(peers[0].platform, 'Android');
    discovery.close();
  });
}

for (const platform of ['darwin', 'win32']) {
  test(`${platform}: window close, Dock activation and quit lifecycle`, async () => {
    const windows = [];
    const app = new EventEmitter();
    Object.assign(app, { setName() {}, whenReady: () => Promise.resolve(), requestSingleInstanceLock: () => true, getPath: () => '/unused', quit() { this.quitCalled = true; } });
    class Window extends EventEmitter {
      constructor(options) {
        super(); this.options = options;
        this.webContents = new EventEmitter();
        this.webContents.setWindowOpenHandler = () => {};
        this.webContents.send = () => {};
        windows.push(this);
      }
      loadFile() {} show() { this.visible = true; } hide() { this.visible = false; }
      focus() {} setIgnoreMouseEvents() {} setAlwaysOnTop() {}
      setBounds(bounds) { this.bounds = bounds; } isDestroyed() { return false; }
    }
    class Engine { async start() { return 12345; } close() {} }
    const actions = {};
    let menu;
    load('main.cjs', {
      electron: { app, Menu: { buildFromTemplate: (items) => items, setApplicationMenu: (items) => { menu = items; } }, BrowserWindow: Window, ipcMain: { handle: (key, fn) => { actions[key] = fn; } }, nativeTheme: {}, screen: { getCursorScreenPoint: () => ({ x: 100, y: 100 }), getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 25, width: 1440, height: 825 } }) } },
      'node:fs': { readFileSync: () => '{"id":"desktop-id","name":"Desktop"}' },
      './engine.cjs': { Engine }, './discovery.cjs': { Discovery: class { close() {} } },
    }, platform);
    await new Promise(setImmediate);
    const main = windows[0];
    if (platform === 'darwin') {
      assert.equal(menu[0].role, 'appMenu');
      assert.equal(menu[1].submenu[0].accelerator, 'Cmd+O');
      assert.equal(menu[1].submenu[2].accelerator, 'Cmd+Return');
    } else assert.equal(menu, undefined);
    main.show();
    let prevented = false;
    main.emit('close', { preventDefault() { prevented = true; } });
    assert.equal(prevented, platform === 'darwin');
    if (platform === 'darwin') assert.equal(main.visible, false);
    app.emit('activate');
    assert.equal(main.visible, true);
    await actions.action({ sender: main.webContents }, { type: 'arm', value: false });
    assert.equal(windows[1].bounds.y, 25);
    assert.equal(windows[2].bounds.y, 25);
    app.emit('before-quit');
    prevented = false;
    main.emit('close', { preventDefault() { prevented = true; } });
    assert.equal(prevented, false, 'Cmd+Q must close the app');
    main.emit('closed');
    assert.equal(app.quitCalled, true);
  });
}
