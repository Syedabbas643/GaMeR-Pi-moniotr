const { execFile } = require("child_process");
const { promisify } = require("util");
const path = require("path");
const fs = require("fs");
let BetterSqlite3 = null;
try {
  BetterSqlite3 = require("better-sqlite3");
} catch (e) {
  BetterSqlite3 = null;
}

const execFileAsync = promisify(execFile);
let dbPathGlobal = null;
let db = null;

function initDatabase(dbPath = path.join(process.cwd(), "metrics.db")) {
  if (dbPathGlobal) return dbPathGlobal;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  dbPathGlobal = dbPath;
  const createSql = `
    CREATE TABLE IF NOT EXISTS metrics (
      ts_ms INTEGER NOT NULL,
      cpu_load1 REAL,
      cpu_load5 REAL,
      cpu_load15 REAL,
      mem_used_mb INTEGER,
      mem_total_mb INTEGER,
      mem_swap_used_mb INTEGER,
      mem_swap_total_mb INTEGER,
      mem_free_mb INTEGER,
      mem_available_mb INTEGER,
      mem_shared_mb INTEGER,
      mem_buffers_mb INTEGER,
      mem_cached_mb INTEGER,
      mem_buffcache_mb INTEGER,
      mem_used_pct REAL,
      disk_used_percent REAL,
      disk_size_bytes INTEGER,
      net_rx_bps REAL,
      net_tx_bps REAL,
      tx_download_bps REAL,
      tx_upload_bps REAL,
      tx_active_torrents INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts_ms);
    CREATE TABLE IF NOT EXISTS storage_metrics (
      ts_ms INTEGER NOT NULL,
      device_fs TEXT NOT NULL,
      mount TEXT,
      device_type TEXT NOT NULL,
      total_bytes INTEGER,
      used_bytes INTEGER,
      use_percent REAL
    );
    CREATE INDEX IF NOT EXISTS idx_storage_ts ON storage_metrics(ts_ms);
    CREATE INDEX IF NOT EXISTS idx_storage_fs ON storage_metrics(device_fs);
  `;
  if (BetterSqlite3) {
    db = new BetterSqlite3(dbPathGlobal);
    db.exec(createSql);
    try {
      db.exec("ALTER TABLE metrics ADD COLUMN mem_swap_used_mb INTEGER");
    } catch (e) { }
    try {
      db.exec("ALTER TABLE metrics ADD COLUMN mem_swap_total_mb INTEGER");
    } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_free_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_available_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_shared_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_buffers_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_cached_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_buffcache_mb INTEGER"); } catch (e) { }
    try { db.exec("ALTER TABLE metrics ADD COLUMN mem_used_pct REAL"); } catch (e) { }
    return dbPathGlobal;
  }
  return execFileAsync("sqlite3", [dbPathGlobal, createSql])
    .then(() => dbPathGlobal)
    .catch(() => dbPathGlobal)
    .finally(async () => {
      try {
        await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_swap_used_mb INTEGER"]);
      } catch (e) { }
      try {
        await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_swap_total_mb INTEGER"]);
      } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_free_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_available_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_shared_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_buffers_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_cached_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_buffcache_mb INTEGER"]); } catch (e) { }
      try { await execFileAsync("sqlite3", [dbPathGlobal, "ALTER TABLE metrics ADD COLUMN mem_used_pct REAL"]); } catch (e) { }
    });
}

function execSql(sql) {
  if (!dbPathGlobal) initDatabase();
  if (db) {
    try {
      const stmt = db.prepare(sql);
      const isSelect = /^\s*select\b/i.test(sql);
      if (isSelect) {
        const rows = stmt.all();
        const cols = (typeof stmt.columns === "function" ? stmt.columns().map((c) => c.name) : (rows[0] ? Object.keys(rows[0]) : []));
        const header = cols.join(",");
        const esc = (v) => {
          if (v === null || v === undefined) return "";
          const s = String(v);
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const lines = [header];
        for (const r of rows) {
          lines.push(cols.map((k) => esc(r[k])).join(","));
        }
        return lines.join("\n");
      } else {
        stmt.run();
        return "";
      }
    } catch (e) {
      return "";
    }
  }
  return execFileAsync("sqlite3", ["-csv", "-header", dbPathGlobal, sql]).then((res) => res.stdout || "");
}

function insertMetric(sample) {
  const vals = {
    ts_ms: Number(sample.ts_ms) || Date.now(),
    cpu_load1: Number(sample.cpu_load1) || 0,
    cpu_load5: Number(sample.cpu_load5) || 0,
    cpu_load15: Number(sample.cpu_load15) || 0,
    mem_used_mb: Number(sample.mem_used_mb) || 0,
    mem_total_mb: Number(sample.mem_total_mb) || 0,
    mem_swap_used_mb: Number(sample.mem_swap_used_mb) || 0,
    mem_swap_total_mb: Number(sample.mem_swap_total_mb) || 0,
    mem_free_mb: Number(sample.mem_free_mb) || 0,
    mem_available_mb: Number(sample.mem_available_mb) || 0,
    mem_shared_mb: Number(sample.mem_shared_mb) || 0,
    mem_buffers_mb: Number(sample.mem_buffers_mb) || 0,
    mem_cached_mb: Number(sample.mem_cached_mb) || 0,
    mem_buffcache_mb: Number(sample.mem_buffcache_mb) || 0,
    mem_used_pct: Number(sample.mem_used_pct) || 0,
    disk_used_percent: Number(sample.disk_used_percent) || 0,
    disk_size_bytes: Number(sample.disk_size_bytes) || 0,
    net_rx_bps: Number(sample.net_rx_bps) || 0,
    net_tx_bps: Number(sample.net_tx_bps) || 0,
    tx_download_bps: Number(sample.tx_download_bps) || 0,
    tx_upload_bps: Number(sample.tx_upload_bps) || 0,
    tx_active_torrents: Number(sample.tx_active_torrents) || 0,
  };
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO metrics (
        ts_ms, cpu_load1, cpu_load5, cpu_load15,
        mem_used_mb, mem_total_mb, mem_swap_used_mb, mem_swap_total_mb,
        mem_free_mb, mem_available_mb, mem_shared_mb, mem_buffers_mb, mem_cached_mb, mem_buffcache_mb, mem_used_pct,
        disk_used_percent, disk_size_bytes,
        net_rx_bps, net_tx_bps,
        tx_download_bps, tx_upload_bps, tx_active_torrents
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      stmt.run(
        vals.ts_ms,
        vals.cpu_load1,
        vals.cpu_load5,
        vals.cpu_load15,
        vals.mem_used_mb,
        vals.mem_total_mb,
        vals.mem_swap_used_mb,
        vals.mem_swap_total_mb,
        vals.mem_free_mb,
        vals.mem_available_mb,
        vals.mem_shared_mb,
        vals.mem_buffers_mb,
        vals.mem_cached_mb,
        vals.mem_buffcache_mb,
        vals.mem_used_pct,
        vals.disk_used_percent,
        vals.disk_size_bytes,
        vals.net_rx_bps,
        vals.net_tx_bps,
        vals.tx_download_bps,
        vals.tx_upload_bps,
        vals.tx_active_torrents
      );
    } catch (e) {
    }
    return "";
  }
  const sql = `
    INSERT INTO metrics (
      ts_ms, cpu_load1, cpu_load5, cpu_load15,
      mem_used_mb, mem_total_mb, mem_swap_used_mb, mem_swap_total_mb,
      mem_free_mb, mem_available_mb, mem_shared_mb, mem_buffers_mb, mem_cached_mb, mem_buffcache_mb, mem_used_pct,
      disk_used_percent, disk_size_bytes,
      net_rx_bps, net_tx_bps,
      tx_download_bps, tx_upload_bps, tx_active_torrents
    ) VALUES (
      ${vals.ts_ms}, ${vals.cpu_load1}, ${vals.cpu_load5}, ${vals.cpu_load15},
      ${vals.mem_used_mb}, ${vals.mem_total_mb}, ${vals.mem_swap_used_mb}, ${vals.mem_swap_total_mb},
      ${vals.mem_free_mb}, ${vals.mem_available_mb}, ${vals.mem_shared_mb}, ${vals.mem_buffers_mb}, ${vals.mem_cached_mb}, ${vals.mem_buffcache_mb}, ${vals.mem_used_pct},
      ${vals.disk_used_percent}, ${vals.disk_size_bytes},
      ${vals.net_rx_bps}, ${vals.net_tx_bps},
      ${vals.tx_download_bps}, ${vals.tx_upload_bps}, ${vals.tx_active_torrents}
    );
  `;
  return execSql(sql).catch(() => "");
}

function insertStorageMetrics(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const ts = Date.now();
  if (db) {
    const stmt = db.prepare(`
      INSERT INTO storage_metrics (ts_ms, device_fs, mount, device_type, total_bytes, used_bytes, use_percent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    try {
      const tx = db.transaction((items) => {
        for (const r of items) {
          stmt.run(
            Number(r.ts_ms) || ts,
            String(r.device_fs || ""),
            String(r.mount || ""),
            String(r.device_type || ""),
            Number(r.total_bytes) || 0,
            Number(r.used_bytes) || 0,
            Number(r.use_percent) || 0
          );
        }
      });
      tx(rows);
    } catch (e) { }
    return "";
  }
  const valuesSql = rows
    .map((r) => `(${Number(r.ts_ms) || ts}, '${String(r.device_fs || "").replace(/'/g, "''")}', '${String(r.mount || "").replace(/'/g, "''")}', '${String(r.device_type || "").replace(/'/g, "''")}', ${Number(r.total_bytes) || 0}, ${Number(r.used_bytes) || 0}, ${Number(r.use_percent) || 0})`)
    .join(", ");
  const sql = `
    INSERT INTO storage_metrics (ts_ms, device_fs, mount, device_type, total_bytes, used_bytes, use_percent)
    VALUES ${valuesSql};
  `;
  return execSql(sql).catch(() => "");
}

function getStorageHistory({ deviceType = null, deviceFs = null, rangeSeconds = null, limit = 360 } = {}) {
  const fromMs = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? Date.now() - rangeSeconds * 1000 : null;
  let base = `SELECT ts_ms, device_fs, mount, device_type, total_bytes, used_bytes, use_percent FROM storage_metrics`;
  const where = [];
  if (deviceType) where.push(`device_type = '${String(deviceType).replace(/'/g, "''")}'`);
  if (deviceFs) where.push(`device_fs = '${String(deviceFs).replace(/'/g, "''")}'`);
  if (Number.isFinite(fromMs) && fromMs > 0) where.push(`ts_ms >= ${fromMs}`);
  const order = ` ORDER BY ts_ms ${Number.isFinite(fromMs) && fromMs > 0 ? "ASC" : "DESC"}`;
  const tail = Number.isFinite(fromMs) && fromMs > 0 ? "" : ` LIMIT ${Number(limit) || 360}`;
  const sql = base + (where.length ? ` WHERE ${where.join(" AND ")}` : "") + order + tail;
  if (db) {
    try {
      const rows = db.prepare(sql).all();
      if (!Number.isFinite(fromMs) || !(fromMs > 0)) rows.reverse();
      return Promise.resolve(rows);
    } catch (e) {
      return Promise.resolve([]);
    }
  }
  return execSql(sql).then((out) => {
    const rows = parseCsvRows(out);
    if (!Number.isFinite(fromMs) || !(fromMs > 0)) rows.reverse();
    return rows;
  });
}

function getHistory({ limit = 360, fromMs = null } = {}) {
  if (db) {
    if (Number.isFinite(fromMs) && fromMs > 0) {
      const stmt = db.prepare(`
        SELECT * FROM metrics
        WHERE ts_ms >= ?
        ORDER BY ts_ms ASC
      `);
      return Promise.resolve(stmt.all(fromMs));
    }
    const stmt = db.prepare(`
      SELECT * FROM metrics
      ORDER BY ts_ms DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit);
    rows.reverse();
    return Promise.resolve(rows);
  }
  if (Number.isFinite(fromMs) && fromMs > 0) {
    const sql = `
      SELECT * FROM metrics
      WHERE ts_ms >= ${fromMs}
      ORDER BY ts_ms ASC;
    `;
    return execSql(sql).then(parseCsvRows);
  }
  const sql = `
    SELECT * FROM metrics
    ORDER BY ts_ms DESC
    LIMIT ${limit};
  `;
  return execSql(sql).then((out) => {
    const rows = parseCsvRows(out);
    return rows.reverse();
  });
}

function parseCsvRows(output) {
  const text = String(output || "").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      const key = header[j];
      const val = cols[j];
      const num = Number(val);
      obj[key] = Number.isFinite(num) ? num : val;
    }
    rows.push(obj);
  }
  return rows;
}

module.exports = {
  initDatabase,
  insertMetric,
  getHistory,
  execSql,
  insertStorageMetrics,
  getStorageHistory,
};
