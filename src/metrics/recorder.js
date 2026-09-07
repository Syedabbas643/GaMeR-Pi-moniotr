const { insertMetric, insertStorageMetrics } = require("../db/sqlite");

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

function buildSample(stats) {
  const ts_ms = Date.now();
  const cpu_load1 = Number(stats?.cpu?.load1min) || 0;
  const cpu_load5 = Number(stats?.cpu?.load5min) || 0;
  const cpu_load15 = Number(stats?.cpu?.load15min) || 0;

  const mem_used_mb = Number(stats?.memory?.used) || 0;
  const mem_total_mb = Number(stats?.memory?.total) || 0;
  const mem_swap_used_mb = Number(stats?.memory?.swapUsed) || 0;
  const mem_swap_total_mb = Number(stats?.memory?.swapTotal) || 0;
  const mem_free_mb = Number(stats?.memory?.free) || 0;
  const mem_available_mb = Number(stats?.memory?.available) || 0;
  const mem_shared_mb = Number(stats?.memory?.shared) || 0;
  const mem_buffers_mb = Number(stats?.memory?.buffers) || 0;
  const mem_cached_mb = Number(stats?.memory?.cached) || 0;
  const mem_buffcache_mb = Number(stats?.memory?.buffCache) || 0;
  const mem_used_pct = Number(stats?.memory?.usedPercent) || 0;

  const disk_used_percent = Number(String(stats?.disk?.used || "0").replace("%", "")) || 0;
  const disk_size_bytes = parseBytes(stats?.disk?.size);

  const netAgg = aggregateNetworkBps(stats?.network?.bandwidth);
  const net_rx_bps = netAgg.rx;
  const net_tx_bps = netAgg.tx;

  const tx_download_bps = Number.isFinite(net_rx_bps) ? 0 : 0; // placeholder
  const tx_upload_bps = Number.isFinite(net_tx_bps) ? 0 : 0; // placeholder

  let tx_active_torrents = 0;
  let tx_dl_bps = 0;
  let tx_ul_bps = 0;
  if (stats?.transmission?.enabled && !stats?.transmission?.error) {
    tx_active_torrents = Number(stats?.transmission?.session?.activeTorrents || 0) || 0;
    tx_dl_bps = parseBandwidthBps(stats?.transmission?.session?.download);
    tx_ul_bps = parseBandwidthBps(stats?.transmission?.session?.upload);
  }

  return {
    ts_ms,
    cpu_load1,
    cpu_load5,
    cpu_load15,
    mem_used_mb,
    mem_total_mb,
    mem_swap_used_mb,
    mem_swap_total_mb,
    mem_free_mb,
    mem_available_mb,
    mem_shared_mb,
    mem_buffers_mb,
    mem_cached_mb,
    mem_buffcache_mb,
    mem_used_pct,
    disk_used_percent,
    disk_size_bytes,
    net_rx_bps,
    net_tx_bps,
    tx_download_bps: tx_dl_bps,
    tx_upload_bps: tx_ul_bps,
    tx_active_torrents,
  };
}

function createMetricsRecorder(statsCollector, { intervalMs = 10_000, onSample } = {}) {
  let timer = null;
  async function tick() {
    try {
      const stats = await statsCollector.getStats();
      const sample = buildSample(stats);
      await insertMetric(sample);
      const rows = [];
      const ts = Date.now();
      const storage = stats?.storage || {};
      for (const item of (storage.hdd || [])) {
        rows.push({
          ts_ms: ts,
          device_fs: item.fs,
          mount: item.mount,
          device_type: "HDD",
          total_bytes: item.totalBytes,
          used_bytes: item.usedBytes,
          use_percent: item.usePercent,
        });
      }
      for (const item of (storage.sd || [])) {
        rows.push({
          ts_ms: ts,
          device_fs: item.fs,
          mount: item.mount,
          device_type: "SD",
          total_bytes: item.totalBytes,
          used_bytes: item.usedBytes,
          use_percent: item.usePercent,
        });
      }
      if (rows.length) await insertStorageMetrics(rows);
      if (typeof onSample === "function") {
        try { onSample(sample, stats); } catch (_e) {}
      }
      const crit = []
        .concat((stats?.storage?.hdd || []).filter(d => d.alert?.status === "crit"))
        .concat((stats?.storage?.sd || []).filter(d => d.alert?.status === "crit"));
      for (const c of crit) {
        try { console.warn(`[ALERTA] Uso crítico en ${c.type} ${c.mount || c.fs}: ${c.usePercent}%`); } catch (e) {}
      }
    } catch (e) {
    }
  }
  function start() {
    if (timer) return;
    timer = setInterval(tick, intervalMs);
    tick();
  }
  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }
  return { start, stop };
}

module.exports = {
  createMetricsRecorder,
};
