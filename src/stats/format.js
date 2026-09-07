function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatBandwidth(bps) {
  if (!Number.isFinite(bps) || bps < 0) return "0.00 bps";
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(2)} Kbps`;
  return `${bps.toFixed(2)} bps`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(2)} ${units[idx]}`;
}

function parseThrottlingStatus(throttledHex) {
  const flags = parseInt(String(throttledHex || "0"), 16) || 0;
  const statusFlags = {
    underVoltage: !!(flags & 0x1),
    frequencyCapped: !!(flags & 0x2),
    throttled: !!(flags & 0x4),
    softTempLimit: !!(flags & 0x8),
    underVoltageOccurred: !!(flags & 0x10000),
    frequencyCappedOccurred: !!(flags & 0x20000),
    throttledOccurred: !!(flags & 0x40000),
    softTempLimitOccurred: !!(flags & 0x80000),
  };

  const activeIssues = [];
  if (statusFlags.underVoltage) activeIssues.push("Undervoltage");
  if (statusFlags.frequencyCapped) activeIssues.push("Frequency Capped");
  if (statusFlags.throttled) activeIssues.push("Throttled");
  if (statusFlags.softTempLimit) activeIssues.push("Soft Temp Limit");

  return {
    status: activeIssues.length > 0 ? activeIssues.join(", ") : "Normal",
    flags: statusFlags,
  };
}

module.exports = {
  formatBandwidth,
  formatBytes,
  formatUptime,
  parseThrottlingStatus,
};
