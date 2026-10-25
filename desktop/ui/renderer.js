document.documentElement.dataset.platform = window.beam.platform;
﻿const $ = (id) => document.getElementById(id),
  action = (type, value) => window.beam.action(type, value);
let autoReceive = true;
let language = null,
  selected = null,
  peers = [],
  staged = null,
  busy = false,
  lastStatus = "",
  pendingConsent = null;
const t = (key) => AppText[language || "en"][key] || key;
function translatedStatus(raw) {
  return language === "ru"
    ? AppText.statuses[raw] ||
        raw
          .replaceAll("MiB", "МБ")
          .replace("Receiver rejected upload:", "Получатель отклонил передачу:")
    : raw;
}
function icon(id) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    u = document.createElementNS(s.namespaceURI, "use");
  u.setAttribute("href", "#" + id);
  s.append(u);
  return s;
}
function size(n) {
  const ru = language === "ru";
  return n < 1024
    ? n + (ru ? " Б" : " B")
    : n < 1048576
      ? (n / 1024).toFixed(1) + (ru ? " КБ" : " KB")
      : (n / 1048576).toFixed(1) + (ru ? " МБ" : " MB");
}
function renderStage() {
  $("staged").textContent = staged ? staged.name : t("drop");
  $("details").textContent = staged
    ? size(staged.size) + " · " + t(staged.kind)
    : t("fileHint");
  $("clear").hidden = !staged;
  $("clear").setAttribute("aria-label", t("clear"));
  $("send").disabled = busy || !staged || !peers.some((p) => p.id === selected);
}
function renderPeers() {
  $("device-count").textContent = String(peers.length);
  const list = $("peers");
  list.replaceChildren();
  $("empty").hidden = peers.length > 0;
  for (const p of peers) {
    const b = document.createElement("button");
    b.className = p.id === selected ? "selected" : "";
    b.setAttribute("aria-pressed", String(p.id === selected));
    const info = document.createElement("span");
    info.className = "peer-copy";
    const name = document.createElement("b");
    name.textContent = p.name;
    const type = document.createElement("small");
    type.textContent = p.platform;
    info.append(name, type);
    b.append(icon(p.platform === "Android" ? "phone" : "device"), info);
    if (p.id === selected) b.append(icon("check"));
    b.onclick = () => {
      selected = p.id;
      action("select", p.id);
      renderPeers();
      renderStage();
    };
    list.append(b);
  }
  renderStage();
}
function renderLanguage() {
  document.documentElement.lang = language || "en";
  for (const e of document.querySelectorAll("[data-text]"))
    e.textContent = t(e.dataset.text);
  $("receive-help").textContent=t(autoReceive?"receiveHint":"receiveManualHint");
  $("language-button").textContent = (language || "en").toUpperCase();
  if ($("arm")) $("arm").setAttribute("aria-label", t("edge")); if ($("method-hint")) $("method-hint").textContent = t($("method-hint").dataset.text || "normalHint");
  $("close-received").setAttribute("aria-label", t("close"));
  $("side").setAttribute("aria-label", t("edge"));
  $("status").textContent = translatedStatus(lastStatus);
  renderPeers();
  if (!$("history-view").hidden) loadHistory("inline-history");
  if (pendingConsent && (pendingConsent.incoming || !pendingConsent.initiated) && language) showConsent();
}
async function chooseLanguage(value) {
  await action("language", value);
  language = value;
  $("onboarding").hidden = true;
  $("application").hidden = false;
  $("language-dialog").close();
  renderLanguage();
}
for (const value of ["ru", "en"]) {
  $("first-" + value).onclick = () => chooseLanguage(value);
  $("set-" + value).onclick = () => chooseLanguage(value);
}
$("auto-receive").onchange=e=>{autoReceive=e.target.checked;action("autoReceive",autoReceive);renderLanguage()};
$("language-button").onclick = () => $("language-dialog").showModal();
for (const type of ["choose", "clipboard", "send", "cancel", "clear"])
  $(type).onclick = () => action(type);
let currentMethod = "normal";
function setMethod(method) {
  currentMethod = method === "edge" ? "edge" : "normal";
  if ($("method-normal")) $("method-normal").classList.toggle("active", currentMethod === "normal");
  if ($("method-edge")) $("method-edge").classList.toggle("active", currentMethod === "edge");
  if ($("edge-help")) $("edge-help").hidden = currentMethod !== "edge";
  if ($("edge-indicator")) $("edge-indicator").classList.toggle("armed", currentMethod === "edge");
  if ($("method-hint")) {
    $("method-hint").dataset.text = currentMethod === "normal" ? "normalHint" : "edgeHelp";
    $("method-hint").textContent = t($("method-hint").dataset.text);
  }
  action("method", currentMethod);
}
if ($("method-normal")) $("method-normal").onclick = () => setMethod("normal");
if ($("method-edge")) $("method-edge").onclick = () => setMethod("edge");
$("side").onchange = (e) => action("side", e.target.value);
$("approve").onclick = () => {
  pendingConsent = null;
  $("consent").close();
  action("approve");
};
$("decline").onclick = () => {
  pendingConsent = null;
  $("consent").close();
  action("cancel");
};
$("consent").addEventListener("cancel", () => {
  pendingConsent = null;
  action("cancel");
});
$("received").onclick = () => {
  loadHistory();
  $("received-dialog").showModal();
};
$("close-received").onclick = () => $("received-dialog").close();
async function loadHistory(target = "history") {
  const entries = await action("history");
  if (!Array.isArray(entries)) return;
  const list = $(target);
  list.replaceChildren();
  if (!entries.length) {
    const p = document.createElement("p");
    p.textContent = t("noFiles");
    list.append(p);
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "history-row";
    const info = document.createElement("div"),
      name = document.createElement("b"),
      meta = document.createElement("small");
    name.textContent = entry.name;
    meta.textContent = size(entry.size);
    info.append(name, meta);
    const b = document.createElement("button");
    b.textContent = t("show");
    b.onclick = () => action("reveal", entry.path);
    row.append(icon("file"), info, b);
    list.append(row);
  }
}
function showConsent() {
  if (!pendingConsent || !language) return;
  const c = pendingConsent;
  $("consent-title").textContent =
    t(c.incoming ? "receiveFrom" : "sendTo") + c.peer;
  $("consent-info").textContent = c.name + " · " + size(c.size);
  $("approve").textContent = t(c.incoming ? "confirm" : "send");

  if (!$("consent").open) $("consent").showModal();
}
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => e.preventDefault());
$("drop").ondragover = (e) => {
  e.preventDefault();
  $("drop").classList.add("drag");
};
$("drop").ondragleave = () => $("drop").classList.remove("drag");
$("drop").ondrop = (e) => {
  e.preventDefault();
  $("drop").classList.remove("drag");
  const f = e.dataTransfer.files[0];
  if (f) action("drop", window.beam.filePath(f));
};
window.beam.onState(({ type, data }) => {
  if (type === "identity") { $("identity").textContent = data.name; $("receive-name").textContent = data.name; }
  if (type === "peers") {
    peers = data;
    renderPeers();
  }
  if (type === "staged") {
    staged = data;
    $("progress").value = 0;
    renderStage();
  }
  if (type === "status" || type === "error") {
    lastStatus = data;
    $("status").textContent = translatedStatus(data);
  }
  if(type === "incoming") {
    busy=true;$("cancel").hidden=false;
    lastStatus="Receiving…";$("status").textContent=translatedStatus(lastStatus);renderStage();
  }
  if (type === "consent") {
    busy = true;
    pendingConsent = data;
    $("cancel").hidden = false;
    lastStatus = "Waiting for receiver to accept…";
    $("status").textContent = translatedStatus(lastStatus);
    if (data.incoming || !data.initiated) showConsent();
    renderStage();
  }
  if (type === "error" || type === "idle") {
    busy = false;
    pendingConsent = null;
    $("consent").close();
    $("cancel").hidden = true;
    renderStage();
  }
  if (type === "progress") {
    $("progress").hidden = false;
    $("progress").value = data.size ? data.bytes / data.size : 1;
    $("status").textContent = size(data.bytes) + " / " + size(data.size);
  }
  if (type === "done") {
    $("progress").value = 1;
    if (!$("history-view").hidden) loadHistory("inline-history");
    lastStatus = "Delivered · integrity verified";
    $("status").textContent = translatedStatus(lastStatus);
    const result = $("result");
    result.replaceChildren();
    if (data.path) {
      const b = document.createElement("button");
      b.textContent = t("show");
      b.onclick = () => action("reveal", data.path);
      result.append(b);
    }
    if (data.text !== undefined && data.text !== null) {
      const b = document.createElement("button");
      b.textContent = t("copy");
      b.onclick = () => action("copy", data.text);
      result.append(b);
    }
  }
});
action("snapshot").then((s) => {
  language = s.language;
  autoReceive=s.autoReceive!==false;
  $("auto-receive").checked=autoReceive;
  selected = s.selected;
  peers = s.peers;
  setMethod(s.method || (s.armed ? "edge" : "normal"));
  staged = s.staged;
  $("identity").textContent = s.name;
  $("receive-name").textContent = s.name;
  $("side").value = s.side || "top";
  lastStatus = s.ready
    ? "Ready · Private LAN discovery active"
    : "Starting LAN services…";
  $("onboarding").hidden = !!language;
  $("application").hidden = !language;
  renderLanguage();
});

for (const button of document.querySelectorAll('[data-view]')) {
  button.onclick=()=>{
    for(const tab of document.querySelectorAll('[data-view]'))tab.classList.toggle('active',tab===button);
    for(const view of ['send','receive','history'])document.getElementById(view+'-view').hidden=view!==button.dataset.view;
    if(button.dataset.view==='history')loadHistory('inline-history');
  };
}
