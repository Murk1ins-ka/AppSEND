const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  shell,
  screen,
  nativeTheme,
  Menu,
} = require("electron");
const path = require("node:path"),
  fs = require("node:fs"),
  os = require("node:os"),
  crypto = require("node:crypto");
const { Engine } = require("./engine.cjs");
const { Discovery } = require("./discovery.cjs");
let main,
  overlay,
  edge,
  engine,
  discovery,
  peers = [],
  selected = null,
  armed = false,
  edgeSide = "top",
  edgeSince = 0,
  edgeFired = false,
  poll,
  quitting = false;
const allowedReceived = new Set();
let preferences = { language: null, autoReceive: true, method: "normal" },
  preferencesPath;
app.setName("AppSEND");
nativeTheme.themeSource = "dark";
function send(type, data) {
  if (main && !main.isDestroyed())
    main.webContents.send("state", { type, data });
}
function trigger() {
  if (!selected || !engine?.staged || engine.active) return;
  const p = peers.find((p) => p.id === selected);
  if (!p) {
    send("error", "Selected device is no longer on the LAN");
    return;
  }
  try {
    engine.connect(p);
  } catch (e) {
    send("error", e.message);
  }
}
function makeWindow(file, opts = {}) {
  const w = new BrowserWindow({
    width: 960,
    height: 820,
    minWidth: 720,
    minHeight: 640,
    backgroundColor: "#000000",
    icon: path.join(__dirname, "assets", process.platform === "win32" ? "icon.ico" : "icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    ...opts,
  });
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.loadFile(path.join(__dirname, "ui", file));
  return w;
}
function setupEdges() {
  const point = screen.getCursorScreenPoint(),
    display = screen.getDisplayNearestPoint(point),
    b = display.workArea;
  overlay.setBounds(b);
  edge.setBounds(
    edgeSide === "top"
      ? { x: b.x, y: b.y, width: b.width, height: 16 }
      : edgeSide === "right"
        ? { x: b.x + b.width - 16, y: b.y, width: 16, height: b.height }
        : { x: b.x, y: b.y, width: 16, height: b.height },
  );
  edge.webContents.send("edge", { side: edgeSide });
  if (armed) edge.showInactive();
  else edge.hide();
}
app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  preferencesPath = path.join(app.getPath("userData"), "preferences.json");
  try {
    const saved = JSON.parse(fs.readFileSync(preferencesPath, "utf8"));
    if (typeof saved.autoReceive === "boolean") preferences.autoReceive=saved.autoReceive;
    if (["ru", "en"].includes(saved.language))
      preferences.language = saved.language;
  } catch {}
  main = makeWindow("index.html");
  if (process.platform === "darwin") {
    const action = (type) => () => {
      main.show();
      main.focus();
      handleAction({ sender: main.webContents }, { type });
    };
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: "appMenu" },
      { label: "File", submenu: [
        { label: "Choose File…", accelerator: "Cmd+O", click: action("choose") },
        { label: "Send Clipboard", accelerator: "Cmd+Shift+V", click: action("clipboard") },
        { label: "Send to Selected Device", accelerator: "Cmd+Return", click: action("send") },
        { type: "separator" },
        { role: "close" },
      ] },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]));
  }
  main.once("ready-to-show", () => {
    if (!process.env.EDGEBEAM_SMOKE) main.show();
  });
  main.on("close", (event) => {
    if (process.platform === "darwin" && !quitting) {
      event.preventDefault();
      main.hide();
    }
  });
  main.on("closed", () => {
    main = null;
    app.quit();
  });
  overlay = makeWindow("overlay.html", {
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    minWidth: 1,
    minHeight: 1,
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, "screen-saver");
  edge = makeWindow("edge.html", {
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    minWidth: 1,
    minHeight: 1,
  });
  edge.setAlwaysOnTop(true, "screen-saver");
  const settings = path.join(app.getPath("userData"), "identity.json");
  let identity;
  try {
    identity = JSON.parse(fs.readFileSync(settings, "utf8"));
  } catch {
    identity = { id: crypto.randomUUID(), name: os.hostname() };
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify(identity));
  }
  engine = new Engine({
    name: identity.name,
    folder: path.join(app.getPath("downloads"), "AppSEND"),
    defaultMotion: preferences.method === "edge" ? "edge" : "plane",
    event: (type, data) => {
      if(type === "consent" && data.incoming && preferences.autoReceive) {
        send("incoming", {name:data.name,size:data.size,peer:data.peer});
        engine.approve();
        return;
      }
      if (type === "animate") {
        setupEdges();
        overlay.showInactive();
        overlay.webContents.send("animation", {
          ...data,
          side: data.side || edgeSide,
        });
        setTimeout(
          () => {
            if (!overlay.isDestroyed()) overlay.hide();
          },
          Math.max(0, data.at - Date.now()) + 1800,
        );
      }
      if (type === "done" && data.path) allowedReceived.add(data.path);
      if (type === "error") overlay.hide();
      send(type, data);
      if (type === "consent" && !data.incoming && data.initiated) engine.approve();
      if (type === "consent" && (data.incoming || !data.initiated)) {
        main.show();
        main.focus();
      }
    },
  });
  try {
    const port = await engine.start();
    discovery = new Discovery(
      identity.id,
      identity.name,
      port,
      (p) => {
        peers = p;
        send("peers", p);
      },
      (e) => send("error", "Discovery: " + e.message),
    );
    const readyState = () => {
      send("identity", identity);
      send("peers", peers);
      send("status", "Ready · Private LAN discovery active");
    };
    main.webContents.on("did-finish-load", readyState);
    readyState();
  } catch (e) {
    send("error", e.message);
  }
  poll = setInterval(() => {
    if (!armed || !engine?.staged) {
      edgeSince = 0;
      return;
    }
    const p = screen.getCursorScreenPoint(),
      d = screen.getDisplayNearestPoint(p),
      b = d.workArea;
    const near =
      edgeSide === "top"
        ? p.y <= b.y + 18
        : edgeSide === "right"
          ? p.x >= b.x + b.width - 18
          : p.x <= b.x + 18;
    if (near) {
      if (!edgeSince) {
        setupEdges();
        edgeSince = Date.now();
      }
      if (!edgeFired && Date.now() - edgeSince > 700) {
        edgeFired = true;
        trigger();
      }
    } else {
      edgeSince = 0;
      edgeFired = false;
    }
  }, 40);
});
function trusted(e) {
  return [main?.webContents, edge?.webContents].includes(e.sender);
}
async function handleAction(e, { type, value }) {
  if (!trusted(e)) throw Error("Untrusted renderer");
  try {
    switch (type) {
      case "snapshot":
        return {
          peers,
          name: os.hostname(),
          staged: engine?.publicStage(),
          ready: !!engine?.server?.listening,
          language: preferences.language,
          autoReceive: preferences.autoReceive,
          side: edgeSide,
          selected,
          armed,
          method: preferences.method || "normal",
        };
      case "autoReceive":
        if(typeof value !== "boolean")throw Error("Invalid receive setting");
        preferences.autoReceive=value;
        await fs.promises.writeFile(preferencesPath,JSON.stringify(preferences),"utf8");
        return value;
      case "language":
        if (!["ru", "en"].includes(value)) throw Error("Invalid language");
        preferences.language = value;
        await fs.promises.mkdir(path.dirname(preferencesPath), {
          recursive: true,
        });
        await fs.promises.writeFile(
          preferencesPath,
          JSON.stringify(preferences),
          "utf8",
        );
        return value;
      case "clear":
        if (engine.active)
          throw Error("Finish or cancel the active transfer first");
        engine.staged = null;
        send("staged", null);
        break;
      case "history": {
        if (!engine?.folder) return [];
        const entries = await fs.promises.readdir(engine.folder, {
          withFileTypes: true,
        });
        const files = await Promise.all(
          entries
            .filter((entry) => entry.isFile() && !entry.name.endsWith(".part"))
            .map(async (entry) => {
              const file = path.join(engine.folder, entry.name),
                stat = await fs.promises.stat(file);
              allowedReceived.add(file);
              return {
                name: entry.name.replace(/^[a-f0-9]{8}-/, ""),
                path: file,
                size: stat.size,
                time: stat.mtimeMs,
              };
            }),
        );
        return files.sort((a, b) => b.time - a.time).slice(0, 1000);
      }
      case "choose": {
        const result = await dialog.showOpenDialog(main, {
          properties: ["openFile"],
        });
        if (!result.canceled) await engine.stageFile(result.filePaths[0]);
        break;
      }
      case "drop":
        if (typeof value !== "string") throw Error("Invalid file");
        await engine.stageFile(value);
        if (e.sender === edge.webContents) trigger();
        break;
      case "clipboard":
        engine.stageText(clipboard.readText());
        break;
      case "text":
        engine.stageText(value);
        break;
      case "select":
        selected = peers.find((p) => p.id === value)?.id || null;
        break;
      case "method": {
        const met = value === "edge" ? "edge" : "normal";
        preferences.method = met;
        armed = met === "edge";
        setupEdges();
        if (engine) engine.defaultMotion = met === "edge" ? "edge" : "plane";
        await fs.promises.mkdir(path.dirname(preferencesPath), { recursive: true });
        await fs.promises.writeFile(preferencesPath, JSON.stringify(preferences), "utf8");
        return met;
      }
      case "arm":
        armed = !!value;
        preferences.method = armed ? "edge" : "normal";
        if (engine) engine.defaultMotion = armed ? "edge" : "plane";
        setupEdges();
        break;
      case "side":
        edgeSide = ["left", "right", "top"].includes(value) ? value : "top";
        setupEdges();
        break;
      case "send":
        if (!selected) throw Error("Select a discovered device");
        if (!engine.staged) throw Error("Stage a file or text");
        trigger();
        break;
      case "approve":
        engine.approve();
        break;
      case "cancel":
        engine.cancel();
        break;
      case "copy":
        if (typeof value === "string" && Buffer.byteLength(value) <= 1048576)
          clipboard.writeText(value);
        break;
      case "reveal":
        if (allowedReceived.has(value)) shell.showItemInFolder(value);
        break;
    }
  } catch (err) {
    send("error", err.message);
  }
}
ipcMain.handle("action", handleAction);
app.on("second-instance", () => {
  main?.show();
  main?.focus();
});
app.on("activate", () => {
  main?.show();
  main?.focus();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  quitting = true;
  clearInterval(poll);
  discovery?.close();
  engine?.close();
});
