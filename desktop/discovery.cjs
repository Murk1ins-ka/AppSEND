const dgram = require("node:dgram"),
  os = require("node:os");
const PORT = 45871;
function broadcasts() {
  const result = new Set(["255.255.255.255"]);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal) continue;
      const a = n.address.split(".").map(Number),
        m = n.netmask.split(".").map(Number);
      result.add(a.map((v, i) => v | (~m[i] & 255)).join("."));
    }
  return [...result];
}
class Discovery {
  constructor(id, name, port, onPeers, onError) {
    this.peers = new Map();
    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("error", onError);
    this.socket.on("message", (buf, r) => {
      try {
        if (buf.length > 2048) return;
        const p = JSON.parse(buf);
        if (
          p.magic !== "edgebeam" ||
          p.v !== 1 ||
          p.id === id ||
          !/^[-a-zA-Z0-9]{1,64}$/.test(p.id) ||
          !Number.isInteger(p.port) ||
          p.port < 1024 ||
          p.port > 65535
        )
          return;
        this.peers.set(p.id, {
          id: p.id,
          name: String(p.name).slice(0, 64),
          platform: String(p.platform).slice(0, 16),
          port: p.port,
          host: r.address,
          seen: Date.now(),
        });
        onPeers([...this.peers.values()]);
      } catch {}
    });
    this.socket.bind(PORT, "0.0.0.0", () => {
      this.socket.setBroadcast(true);
      const tick = () => {
        const msg = Buffer.from(
          JSON.stringify({
            magic: "edgebeam",
            v: 1,
            id,
            name,
            platform: process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux",
            port,
          }),
        );
        for (const host of broadcasts())
          this.socket.send(msg, PORT, host, () => {});
        for (const [key, p] of this.peers)
          if (Date.now() - p.seen > 7000) this.peers.delete(key);
        onPeers([...this.peers.values()]);
      };
      tick();
      this.timer = setInterval(tick, 2000);
    });
  }
  close() {
    clearInterval(this.timer);
    this.socket.close();
  }
}
module.exports = { Discovery };
