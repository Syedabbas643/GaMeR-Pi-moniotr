const client = require("prom-client");
const { numberFromEnv } = (() => {
  try {
    const cfg = require("../config");
    return { numberFromEnv: (name, fallback) => {
      const raw = process.env[name];
      if (raw == null || raw === "") return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : fallback;
    }};
  } catch (_e) {
    return { numberFromEnv: (name, fallback) => fallback };
  }
})();

function parseBandwidthBps(text) {
  if (!text || typeof text !== "string") return 0;
  const match = text.trim().match(/^([\d.]+)\s*(Gbps|Mbps|Kbps|bps)$/i);
  if (!match) return 0;
  const value = Number(match[1]) || 0;
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "gbps":
      return value * 1_000_000_000;
    case "mbps":
      return value * 1_000_000;
    case "kbps":
      return value * 1_000;
    case "bps":
    default:
      return value;
  }
}

function parseBytes(text) {
  if (!text || typeof text !== "string") return 0;
  const match = text.trim().match(/^([\d.]+)\s*(tb|gb|mb|kb|b)$/i);
  if (!match) return 0;
  const value = Number(match[1]) || 0;
  const unit = match[2].toLowerCase();
  switch (unit) {
    case "tb":
      return Math.round(value * 1024 * 1024 * 1024 * 1024);
    case "gb":
      return Math.round(value * 1024 * 1024 * 1024);
    case "mb":
      return Math.round(value * 1024 * 1024);
    case "kb":
      return Math.round(value * 1024);
    case "b":
    default:
      return Math.round(value);
  }
}

function aggregateNetworkBps(bandwidth) {
  let rx = 0;
  let tx = 0;
  if (!bandwidth || typeof bandwidth !== "object") return { rx, tx };
  for (const stats of Object.values(bandwidth)) {
    rx += parseBandwidthBps(stats?.rx);
    tx += parseBandwidthBps(stats?.tx);
  }
  return { rx, tx };
}

function createPrometheusMetrics(statsCollector, { prefix = "system_monitor_", intervalMs } = {}) {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register, prefix });

  const gCpuLoad1 = new client.Gauge({ name: `${prefix}cpu_load1`, help: "Carga media 1m" });
  const gCpuLoad5 = new client.Gauge({ name: `${prefix}cpu_load5`, help: "Carga media 5m" });
  const gCpuLoad15 = new client.Gauge({ name: `${prefix}cpu_load15`, help: "Carga media 15m" });

  const gMemTotalMb = new client.Gauge({ name: `${prefix}mem_total_mb`, help: "Memoria total MB" });
  const gMemUsedMb = new client.Gauge({ name: `${prefix}mem_used_mb`, help: "Memoria usada MB" });
  const gMemFreeMb = new client.Gauge({ name: `${prefix}mem_free_mb`, help: "Memoria libre MB" });
  const gMemAvailableMb = new client.Gauge({ name: `${prefix}mem_available_mb`, help: "Memoria disponible MB" });
  const gMemUsedPct = new client.Gauge({ name: `${prefix}mem_used_pct`, help: "Memoria usada %" });
  const gSwapTotalMb = new client.Gauge({ name: `${prefix}swap_total_mb`, help: "Swap total MB" });
  const gSwapUsedMb = new client.Gauge({ name: `${prefix}swap_used_mb`, help: "Swap usada MB" });

  const gDiskUsedPct = new client.Gauge({ name: `${prefix}disk_used_pct`, help: "Disco usado %" });
  const gDiskSizeBytes = new client.Gauge({ name: `${prefix}disk_size_bytes`, help: "Tamaño disco bytes" });

  const gNetRxBps = new client.Gauge({ name: `${prefix}net_rx_bps`, help: "Red RX bps agregados" });
  const gNetTxBps = new client.Gauge({ name: `${prefix}net_tx_bps`, help: "Red TX bps agregados" });

  const gTxActive = new client.Gauge({ name: `${prefix}tx_active_torrents`, help: "Torrents activos" });
  const gTxDlBps = new client.Gauge({ name: `${prefix}tx_download_bps`, help: "Transmission descarga bps" });
  const gTxUlBps = new client.Gauge({ name: `${prefix}tx_upload_bps`, help: "Transmission subida bps" });

  register.registerMetric(gCpuLoad1);
  register.registerMetric(gCpuLoad5);
  register.registerMetric(gCpuLoad15);
  register.registerMetric(gMemTotalMb);
  register.registerMetric(gMemUsedMb);
  register.registerMetric(gMemFreeMb);
  register.registerMetric(gMemAvailableMb);
  register.registerMetric(gMemUsedPct);
  register.registerMetric(gSwapTotalMb);
  register.registerMetric(gSwapUsedMb);
  register.registerMetric(gDiskUsedPct);
  register.registerMetric(gDiskSizeBytes);
  register.registerMetric(gNetRxBps);
  register.registerMetric(gNetTxBps);
  register.registerMetric(gTxActive);
  register.registerMetric(gTxDlBps);
  register.registerMetric(gTxUlBps);

  function updateFromStats(stats) {
    try {
      const cpu1 = Number(stats?.cpu?.load1min) || 0;
      const cpu5 = Number(stats?.cpu?.load5min) || 0;
      const cpu15 = Number(stats?.cpu?.load15min) || 0;
      gCpuLoad1.set(cpu1);
      gCpuLoad5.set(cpu5);
      gCpuLoad15.set(cpu15);

      const mt = Number(stats?.memory?.total) || 0;
      const mu = Number(stats?.memory?.used) || 0;
      const mf = Number(stats?.memory?.free) || 0;
      const ma = Number(stats?.memory?.available) || 0;
      const mup = Number(stats?.memory?.usedPercent) || 0;
      const st = Number(stats?.memory?.swapTotal) || 0;
      const su = Number(stats?.memory?.swapUsed) || 0;
      gMemTotalMb.set(mt);
      gMemUsedMb.set(mu);
      gMemFreeMb.set(mf);
      gMemAvailableMb.set(ma);
      gMemUsedPct.set(mup);
      gSwapTotalMb.set(st);
      gSwapUsedMb.set(su);

      const diskUsedPct = Number(String(stats?.disk?.used || "0").replace("%", "")) || 0;
      const diskSizeBytes = parseBytes(stats?.disk?.size);
      gDiskUsedPct.set(diskUsedPct);
      gDiskSizeBytes.set(diskSizeBytes);

      const netAgg = aggregateNetworkBps(stats?.network?.bandwidth);
      gNetRxBps.set(netAgg.rx);
      gNetTxBps.set(netAgg.tx);

      let txActive = 0;
      let txDl = 0;
      let txUl = 0;
      if (stats?.transmission?.enabled && !stats?.transmission?.error) {
        txActive = Number(stats?.transmission?.session?.activeTorrents || 0) || 0;
        txDl = parseBandwidthBps(stats?.transmission?.session?.download);
        txUl = parseBandwidthBps(stats?.transmission?.session?.upload);
      }
      gTxActive.set(txActive);
      gTxDlBps.set(txDl);
      gTxUlBps.set(txUl);
    } catch (_e) { }
  }

  function updateFromSample(sample) {
    try {
      gCpuLoad1.set(Number(sample?.cpu_load1) || 0);
      gCpuLoad5.set(Number(sample?.cpu_load5) || 0);
      gCpuLoad15.set(Number(sample?.cpu_load15) || 0);
      gMemTotalMb.set(Number(sample?.mem_total_mb) || 0);
      gMemUsedMb.set(Number(sample?.mem_used_mb) || 0);
      gMemFreeMb.set(Number(sample?.mem_free_mb) || 0);
      gMemAvailableMb.set(Number(sample?.mem_available_mb) || 0);
      gMemUsedPct.set(Number(sample?.mem_used_pct) || 0);
      gSwapTotalMb.set(Number(sample?.mem_swap_total_mb) || 0);
      gSwapUsedMb.set(Number(sample?.mem_swap_used_mb) || 0);
      gDiskUsedPct.set(Number(sample?.disk_used_percent) || 0);
      gDiskSizeBytes.set(Number(sample?.disk_size_bytes) || 0);
      gNetRxBps.set(Number(sample?.net_rx_bps) || 0);
      gNetTxBps.set(Number(sample?.net_tx_bps) || 0);
      gTxActive.set(Number(sample?.tx_active_torrents) || 0);
      gTxDlBps.set(Number(sample?.tx_download_bps) || 0);
      gTxUlBps.set(Number(sample?.tx_upload_bps) || 0);
    } catch (_e) { }
  }

  let timer = null;
  const effectiveIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : numberFromEnv("PROM_INTERVAL_MS", 10000);

  async function tick() {
    try {
      if (!statsCollector || typeof statsCollector.getStats !== "function") return;
      const stats = await statsCollector.getStats();
      updateFromStats(stats);
    } catch (_e) { }
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, effectiveIntervalMs);
    tick();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { register, updateFromStats, updateFromSample, start, stop };
}

module.exports = {
  createPrometheusMetrics,
};

