const os = require("os");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const https = require("https");
const si = require("systeminformation");
const http = require("http");

const { formatBandwidth, formatBytes, formatUptime, parseThrottlingStatus } = require("./format");
const {
  COMMAND_TIMEOUT_MS,
  PUBLIC_IP_TIMEOUT_MS,
  TRANSMISSION_URL,
  TRANSMISSION_USERNAME,
  TRANSMISSION_PASSWORD,
  TRANSMISSION_TIMEOUT_MS,
  MEMORY_WARN_PERCENT,
  MEMORY_CRIT_PERCENT,
  DISK_WARN_PERCENT,
  DISK_CRIT_PERCENT,
  DEBUG_STATS,
} = require("../config");

const execAsync = promisify(exec);
const transmissionSessionIds = new Map();

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

function extractTransmissionSessionIdFromText(text) {
  const match = String(text || "").match(/X-Transmission-Session-Id:\s*([^\s<]+)/i);
  return match ? match[1] : null;
}

function getTransmissionEndpoint() {
  const url = new URL(TRANSMISSION_URL);
  const isHttps = url.protocol === "https:";
  const mod = isHttps ? https : http;
  const port = url.port ? Number(url.port) : (isHttps ? 443 : 80);
  const path = url.pathname && url.pathname !== "/" ? url.pathname : "/transmission/rpc";
  const key = `${url.protocol}//${url.hostname}:${port}${path}`;
  return { url, isHttps, mod, port, path, key };
}

function logDebug(event, data) {
  if (!DEBUG_STATS) return;
  try {
    const payload = { t: new Date().toISOString(), event, ...data };
    console.error("[stats]", JSON.stringify(payload));
  } catch (_e) { }
}

async function runCommand(command, { timeoutMs = COMMAND_TIMEOUT_MS, envAppend = {}, cwd, debugEvent } = {}) {
  try {
    const env = { ...process.env, ...envAppend };
    const basePath = String(env.PATH || "");
    const extraPath = ["/usr/bin", "/opt/vc/bin"].filter((p) => !basePath.includes(p)).join(":");
    env.PATH = extraPath ? (basePath ? basePath + ":" + extraPath : extraPath) : basePath;
    const { stdout, stderr } = await execAsync(command, { timeout: timeoutMs, windowsHide: true, env, cwd });
    const out = String(stdout || "").trim();
    if (debugEvent) {
      logDebug(debugEvent, { command, cwd: cwd || process.cwd(), path: env.PATH, stdout: out, stderr: String(stderr || "").trim() });
    }
    return out;
  } catch (error) {
    if (debugEvent) {
      logDebug(debugEvent, { command, cwd: cwd || process.cwd(), path: (process.env.PATH || ""), error: String(error && error.message || error) });
    }
    return null;
  }
}

let vcgencmdDiagnosed = false;

async function diagnoseVcgencmd() {
  if (vcgencmdDiagnosed) return;
  vcgencmdDiagnosed = true;
  try {
    const user = process.env.USER || null;
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    const gid = typeof process.getgid === "function" ? process.getgid() : null;
    const path = process.env.PATH || "";
    const cwd = process.cwd();
    const groups = await runCommand("id -nG", { timeoutMs: 1500, debugEvent: "id_groups" });
    let usrVcgencmd = null;
    let optVcgencmd = null;
    try { await fs.access("/usr/bin/vcgencmd"); usrVcgencmd = "/usr/bin/vcgencmd"; } catch (_e) { }
    try { await fs.access("/opt/vc/bin/vcgencmd"); optVcgencmd = "/opt/vc/bin/vcgencmd"; } catch (_e) { }
    let vchiq = null;
    try {
      const st = await fs.stat("/dev/vchiq");
      vchiq = { mode: st.mode, gid: st.gid, uid: st.uid };
    } catch (_e) { }
    const which = await runCommand("which vcgencmd", { timeoutMs: 1500, debugEvent: "which_vcgencmd" });
    const ver1 = await runCommand("/usr/bin/vcgencmd version", { timeoutMs: 1500, debugEvent: "vcgencmd_version_usr" });
    const ver2 = await runCommand("/opt/vc/bin/vcgencmd version", { timeoutMs: 1500, debugEvent: "vcgencmd_version_opt" });
    logDebug("vcgencmd_diagnostics", { user, uid, gid, path, cwd, groups, usrVcgencmd, optVcgencmd, vchiq, which, verUsr: ver1, verOpt: ver2 });
  } catch (_e) { }
}

async function getNetworkStats() {
  try {
    const list = await si.networkStats();
    const stats = {};
    for (const item of list || []) {
      const iface = String(item.iface || "").trim();
      if (!iface) continue;
      stats[iface] = {
        rxBytes: Number(item.rx_bytes) || 0,
        txBytes: Number(item.tx_bytes) || 0,
      };
    }
    return stats;
  } catch (_error) {
    return {};
  }
}

function calculateNetworkBandwidth(currentStats, previousStats, timeDeltaSeconds) {
  const bandwidth = {};
  if (!previousStats || timeDeltaSeconds <= 0) return bandwidth;

  for (const [iface, current] of Object.entries(currentStats)) {
    const previous = previousStats[iface];
    if (!previous) continue;

    const rxDeltaBytes = current.rxBytes - previous.rxBytes;
    const txDeltaBytes = current.txBytes - previous.txBytes;

    const rxBps = (rxDeltaBytes / timeDeltaSeconds) * 8;
    const txBps = (txDeltaBytes / timeDeltaSeconds) * 8;

    bandwidth[iface] = {
      rx: formatBandwidth(rxBps),
      tx: formatBandwidth(txBps),
    };
  }

  return bandwidth;
}

function formatTotals(currentStats) {
  const perInterface = {};
  let aggRx = 0;
  let aggTx = 0;
  for (const [iface, cur] of Object.entries(currentStats)) {
    const rx = Number(cur.rxBytes) || 0;
    const tx = Number(cur.txBytes) || 0;
    perInterface[iface] = {
      rxTotal: formatBytes(rx),
      txTotal: formatBytes(tx),
    };
    aggRx += rx;
    aggTx += tx;
  }
  return {
    perInterface,
    aggregate: {
      rxTotal: formatBytes(aggRx),
      txTotal: formatBytes(aggTx),
    },
  };
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = { ipv4: [], ipv6: [] };

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!Array.isArray(addrs)) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        ips.ipv4.push({ interface: name, address: addr.address });
      } else if (addr.family === "IPv6" && !addr.internal) {
        ips.ipv6.push({ interface: name, address: addr.address });
      }
    }
  }

  return ips;
}

function getPublicIP() {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.ipify.org",
        path: "/?format=json",
        method: "GET",
        timeout: 5000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip || null);
          } catch (_e) {
            resolve(null);
          }
        });
      }
    );

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

async function getDiskUsage() {
  try {
    const disks = await si.fsSize();
    let target = null;
    for (const d of disks || []) {
      if (d.mount === "/") {
        target = d;
        break;
      }
    }
    if (!target && (disks || []).length > 0) {
      target = disks.reduce((a, b) => ((b.size || 0) > (a.size || 0) ? b : a), disks[0]);
    }
    if (!target) return { used: "N/A", size: "N/A" };
    const sizeBytes = Number(target.size) || 0;
    const usedPercent =
      Number.isFinite(target.use) && target.use > 0
        ? Number(target.use)
        : sizeBytes > 0
          ? ((Number(target.used) || 0) / sizeBytes) * 100
          : 0;
    return { used: `${usedPercent.toFixed(0)}%`, size: formatBytes(sizeBytes) };
  } catch (_error) {
    return { used: "N/A", size: "N/A" };
  }
}

function classifyStorageDevice(fsPath) {
  const name = String(fsPath || "").toLowerCase();
  if (!name) return null;
  if (name.includes("mmcblk")) return "SD";
  if (name.includes("/dev/sd") || name.includes("nvme")) return "HDD";
  return null;
}

async function getStorageDevices() {
  try {
    const list = await si.fsSize();
    const out = { hdd: [], sd: [] };
    for (const d of list || []) {
      const type = classifyStorageDevice(d.fs);
      if (!type) continue;
      const total = Number(d.size) || 0;
      const used = Number(d.used) || 0;
      const pct = Number.isFinite(d.use) && d.use > 0 ? Number(d.use) : (total > 0 ? (used / total) * 100 : 0);
      let alert = { status: "ok", threshold: DISK_WARN_PERCENT, usedPercent: Number(pct.toFixed(1)) };
      if (pct >= DISK_CRIT_PERCENT) {
        alert = { status: "crit", threshold: DISK_CRIT_PERCENT, usedPercent: Number(pct.toFixed(1)) };
      } else if (pct >= DISK_WARN_PERCENT) {
        alert = { status: "warn", threshold: DISK_WARN_PERCENT, usedPercent: Number(pct.toFixed(1)) };
      }
      const item = {
        fs: d.fs,
        mount: d.mount,
        type,
        totalBytes: total,
        usedBytes: used,
        usePercent: Number(pct.toFixed(1)),
        total: formatBytes(total),
        used: formatBytes(used),
        alert,
      };
      if (type === "HDD") out.hdd.push(item);
      if (type === "SD") out.sd.push(item);
    }
    return out;
  } catch (_e) {
    return { hdd: [], sd: [] };
  }
}

async function getGpuTemp() {
  try {
    const graphics = await si.graphics();
    const controller = (graphics.controllers || []).find((c) => Number.isFinite(c.temperatureGpu));
    const temp = controller ? controller.temperatureGpu : null;
    if (Number.isFinite(temp)) {
      return `${Number(temp).toFixed(1)}°C`;
    }
  } catch (_error) {
    // ignore and try vcgencmd below
  }
  let stdout = await runCommand("/usr/bin/vcgencmd measure_temp", { debugEvent: "vcgencmd_measure_temp_usr" });
  if (!stdout) stdout = await runCommand("/opt/vc/bin/vcgencmd measure_temp", { debugEvent: "vcgencmd_measure_temp_opt" });
  if (!stdout) stdout = await runCommand("vcgencmd measure_temp", { debugEvent: "vcgencmd_measure_temp_path" });
  if (stdout) return stdout.replace("temp=", "").replace("'C", "°C");
  await diagnoseVcgencmd();
  try {
    const zonesDir = "/sys/class/thermal";
    const entries = await fs.readdir(zonesDir).catch(() => []);
    const temps = [];
    for (const name of entries) {
      if (!String(name || "").startsWith("thermal_zone")) continue;
      const base = `${zonesDir}/${name}`;
      const type = await fs.readFile(`${base}/type`, "utf8").catch(() => null);
      const raw = await fs.readFile(`${base}/temp`, "utf8").catch(() => null);
      if (!raw) continue;
      const millidegrees = Number.parseInt(String(raw).trim(), 10);
      if (!Number.isFinite(millidegrees)) continue;
      temps.push({ type: String(type || "").toLowerCase(), celsius: millidegrees / 1000 });
    }
    temps.sort((a, b) => b.celsius - a.celsius);
    let selected = null;
    selected = temps.find((t) => t.type.includes("gpu") || t.type.includes("v3d") || t.type.includes("graphic")) || null;
    if (!selected) selected = temps.find((t) => t.type.includes("soc") || t.type.includes("cpu")) || null;
    if (!selected && temps.length > 0) selected = temps[0];
    if (selected) {
      logDebug("thermal_zone_selected", { type: selected.type, temp: selected.celsius });
      return `${Number(selected.celsius).toFixed(1)}°C`;
    }
  } catch (_e) { }
  return "0.0°C";
}

async function getThrottlingHex() {
  let stdout = await runCommand("/usr/bin/vcgencmd get_throttled", { debugEvent: "vcgencmd_get_throttled_usr" });
  if (!stdout) stdout = await runCommand("/opt/vc/bin/vcgencmd get_throttled", { debugEvent: "vcgencmd_get_throttled_opt" });
  if (!stdout) stdout = await runCommand("vcgencmd get_throttled", { debugEvent: "vcgencmd_get_throttled_path" });
  if (!stdout) return "0x0";
  return stdout.trim().replace("throttled=", "");
}

async function getCpuTemp() {
  try {
    const t = await si.cpuTemperature();
    const temp =
      Array.isArray(t?.cores) && t.cores.length
        ? t.cores[0]
        : Number.isFinite(t?.main)
          ? t.main
          : null;
    if (!Number.isFinite(temp)) {
      const raw = await fs.readFile("/sys/class/thermal/thermal_zone0/temp", "utf8").catch(() => null);
      if (!raw) return "0.0°C";
      const millidegrees = Number.parseInt(String(raw).trim(), 10) || 0;
      return `${(millidegrees / 1000).toFixed(1)}°C`;
    }
    return `${Number(temp).toFixed(1)}°C`;
  } catch (_error) {
    return "0.0°C";
  }
}

function transmissionHttpRequest(endpoint, body, sessionId) {
  if (!TRANSMISSION_URL) return Promise.resolve(null);
  try {
    const authHeader =
      TRANSMISSION_USERNAME && TRANSMISSION_PASSWORD
        ? "Basic " + Buffer.from(`${TRANSMISSION_USERNAME}:${TRANSMISSION_PASSWORD}`).toString("base64")
        : null;
    const payload = JSON.stringify(body || {});
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    };
    if (authHeader) headers["Authorization"] = authHeader;
    if (sessionId) headers["X-Transmission-Session-Id"] = sessionId;
    const options = {
      hostname: endpoint.url.hostname,
      port: endpoint.port,
      path: endpoint.path,
      method: "POST",
      timeout: TRANSMISSION_TIMEOUT_MS || 3000,
      headers,
    };
    return new Promise((resolve) => {
      const req = endpoint.mod.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const sessionHeader =
            res.headers["x-transmission-session-id"] || extractTransmissionSessionIdFromText(data);
          try {
            const json = JSON.parse(data || "{}");
            resolve({ statusCode: res.statusCode || 0, data: json, sessionId: sessionHeader || null });
          } catch (_e) {
            resolve({ statusCode: res.statusCode || 0, data: null, sessionId: sessionHeader || null });
          }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.write(payload);
      req.end();
    });
  } catch (_e) {
    return Promise.resolve(null);
  }
}

async function transmissionRpc(body) {
  let endpoint;
  try {
    endpoint = getTransmissionEndpoint();
  } catch (_e) {
    return null;
  }
  const cachedSessionId = transmissionSessionIds.get(endpoint.key) || null;
  const first = await transmissionHttpRequest(endpoint, body, cachedSessionId);
  if (!first) return null;
  if (first.sessionId) transmissionSessionIds.set(endpoint.key, first.sessionId);
  if (first.statusCode === 409) {
    const retrySessionId = first.sessionId || transmissionSessionIds.get(endpoint.key) || null;
    if (!retrySessionId) return first;
    const second = await transmissionHttpRequest(endpoint, body, retrySessionId);
    if (!second) return null;
    if (second.sessionId) transmissionSessionIds.set(endpoint.key, second.sessionId);
    if (second.statusCode === 409 && second.sessionId && second.sessionId !== retrySessionId) {
      const third = await transmissionHttpRequest(endpoint, body, second.sessionId);
      if (third?.sessionId) transmissionSessionIds.set(endpoint.key, third.sessionId);
      return third;
    }
    return second;
  }
  return first;
}

function mapTransmissionStatus(code) {
  switch (code) {
    case 0:
      return "stopped";
    case 1:
      return "check_wait";
    case 2:
      return "checking";
    case 3:
      return "download_wait";
    case 4:
      return "downloading";
    case 5:
      return "seed_wait";
    case 6:
      return "seeding";
    default:
      return "unknown";
  }
}

async function getTransmissionStats() {
  if (!TRANSMISSION_URL) {
    return { enabled: false, reason: "TRANSMISSION_URL no configurada" };
  }
  try {
    new URL(TRANSMISSION_URL);
  } catch (_e) {
    return { enabled: true, error: "TRANSMISSION_URL inválida" };
  }
  const txTimeoutMs = Number(TRANSMISSION_TIMEOUT_MS) || 3000;
  const sessionReq = await withTimeout(
    transmissionRpc({ method: "session-stats", arguments: {} }),
    txTimeoutMs * 2
  );
  const torrentsReq = await withTimeout(
    transmissionRpc({
      method: "torrent-get",
      arguments: {
        fields: ["id", "name", "status", "rateDownload", "rateUpload", "percentDone", "errorString"],
      },
    }),
    txTimeoutMs * 2
  );
  if (!sessionReq || !torrentsReq || !sessionReq.data || !torrentsReq.data) {
    return { enabled: true, error: "No disponible" };
  }
  const session = sessionReq.data.arguments || {};
  const torrents = Array.isArray(torrentsReq.data.arguments?.torrents)
    ? torrentsReq.data.arguments.torrents
    : [];
  const active = torrents.filter((t) => t && (t.status === 4 || t.status === 6));
  return {
    enabled: true,
    session: {
      download: formatBandwidth(((session.downloadSpeed || 0) * 8) || 0),
      upload: formatBandwidth(((session.uploadSpeed || 0) * 8) || 0),
      activeTorrents: Number(session.activeTorrentCount || 0),
      pausedTorrents: Number(session.pausedTorrentCount || 0),
    },
    torrents: active.map((t) => ({
      id: t.id,
      name: t.name,
      status: mapTransmissionStatus(t.status),
      download: formatBandwidth(((t.rateDownload || 0) * 8) || 0),
      upload: formatBandwidth(((t.rateUpload || 0) * 8) || 0),
      progress: ((t.percentDone || 0) * 100).toFixed(1) + "%",
      error: t.errorString || "",
    })),
  };
}

function createStatsCollector({ now = () => Date.now() } = {}) {
  let previousNetworkStats = null;
  let previousNetworkTimestampMs = null;

  async function getStats() {
    const loadAvg = os.loadavg();
    const uptimeSeconds = os.uptime();
    let totalMem = os.totalmem();
    let usedMem = totalMem - os.freemem();
    let swapTotal = 0;
    let swapUsed = 0;
    let freeMem = os.freemem();
    let availableMem = 0;
    let sharedMem = 0;
    let buffersMem = 0;
    let cachedMem = 0;
    try {
      const mem = await si.mem();
      if (mem && Number.isFinite(mem.total) && Number.isFinite(mem.used)) {
        totalMem = mem.total;
        usedMem = mem.used;
      }
      if (mem && Number.isFinite(mem.swaptotal) && Number.isFinite(mem.swapused)) {
        swapTotal = mem.swaptotal;
        swapUsed = mem.swapused;
      }
      if (mem && Number.isFinite(mem.free)) {
        freeMem = mem.free;
      }
      if (mem && Number.isFinite(mem.available)) {
        availableMem = mem.available;
      }
      if (mem && Number.isFinite(mem.shared)) {
        sharedMem = mem.shared;
      }
      if (mem && Number.isFinite(mem.buffers)) {
        buffersMem = mem.buffers;
      }
      if (mem && Number.isFinite(mem.cached)) {
        cachedMem = mem.cached;
      }
    } catch (_e) { }

    const currentNetworkStats = await getNetworkStats();
    const currentTimestampMs = now();

    const timeDeltaSeconds =
      previousNetworkTimestampMs == null ? 0 : (currentTimestampMs - previousNetworkTimestampMs) / 1000;

    const networkBandwidth = calculateNetworkBandwidth(
      currentNetworkStats,
      previousNetworkStats,
      timeDeltaSeconds
    );
    const networkTotals = formatTotals(currentNetworkStats);

    previousNetworkStats = currentNetworkStats;
    previousNetworkTimestampMs = currentTimestampMs;

    const localIPs = getLocalIPs();

    const [disk, throttlingHex, gpuTemp, cpuTemp, publicIP, transmission] = await Promise.all([
      getDiskUsage(),
      getThrottlingHex(),
      getGpuTemp(),
      getCpuTemp(),
      withTimeout(getPublicIP(), PUBLIC_IP_TIMEOUT_MS),
      getTransmissionStats(),
    ]);
    const storage = await getStorageDevices();

    const usedPercent = totalMem > 0 ? ((usedMem / totalMem) * 100) : 0;
    const usedPercentFixed = usedPercent.toFixed(1);
    const memWarnPercent = Number.isFinite(Number(MEMORY_WARN_PERCENT)) ? Number(MEMORY_WARN_PERCENT) : 80;
    const memCritPercent = Number.isFinite(Number(MEMORY_CRIT_PERCENT)) ? Number(MEMORY_CRIT_PERCENT) : 90;
    let memAlert = { status: "ok", threshold: memWarnPercent, usedPercent: Number(usedPercentFixed) };
    if (usedPercent >= memCritPercent) {
      memAlert = { status: "crit", threshold: memCritPercent, usedPercent: Number(usedPercentFixed) };
    } else if (usedPercent >= memWarnPercent) {
      memAlert = { status: "warn", threshold: memWarnPercent, usedPercent: Number(usedPercentFixed) };
    }
    return {
      cpu: {
        load1min: loadAvg[0].toFixed(2),
        load5min: loadAvg[1].toFixed(2),
        load15min: loadAvg[2].toFixed(2),
      },
      uptime: {
        seconds: uptimeSeconds,
        formatted: formatUptime(uptimeSeconds),
      },
      memory: {
        total: (totalMem / 1024 / 1024).toFixed(0),
        used: (usedMem / 1024 / 1024).toFixed(0),
        free: (freeMem / 1024 / 1024).toFixed(0),
        shared: (sharedMem / 1024 / 1024).toFixed(0),
        buffers: (buffersMem / 1024 / 1024).toFixed(0),
        cached: (cachedMem / 1024 / 1024).toFixed(0),
        buffCache: (((buffersMem + cachedMem) / 1024 / 1024)).toFixed(0),
        available: (availableMem / 1024 / 1024).toFixed(0),
        swapTotal: (swapTotal / 1024 / 1024).toFixed(0),
        swapUsed: (swapUsed / 1024 / 1024).toFixed(0),
        usedPercent: usedPercentFixed,
        alert: memAlert,
      },
      disk,
      storage,
      temperature: {
        cpu: cpuTemp,
        gpu: gpuTemp,
      },
      network: {
        bandwidth: networkBandwidth,
        totals: networkTotals,
      },
      ipAddresses: {
        public: publicIP || "Unable to fetch",
        local: localIPs,
      },
      throttling: parseThrottlingStatus(throttlingHex),
      transmission,
    };
  }

  return { getStats };
}

module.exports = {
  createStatsCollector,
};
