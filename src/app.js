const express = require("express");
const { NODE_ENV, PUBLIC_DIR, METRICS_INTERVAL_MS, DISABLE_SQLITE } = require("./config");
const { createStatsCollector } = require("./stats");
const { initDatabase, getHistory, execSql } = require("./db/sqlite");
const { createMetricsRecorder } = require("./metrics/recorder");
const { createPrometheusMetrics } = require("./metrics/prometheus");

function createApp() {
  const app = express();
  const statsCollector = createStatsCollector();
  const prom = createPrometheusMetrics(statsCollector, { intervalMs: METRICS_INTERVAL_MS });
  if (!DISABLE_SQLITE) {
    initDatabase();
    const recorder = createMetricsRecorder(statsCollector, { intervalMs: METRICS_INTERVAL_MS, onSample: prom.updateFromSample });
    recorder.start();
  }
  if (DISABLE_SQLITE) {
    prom.start();
  }

  app.use(express.static(PUBLIC_DIR));

  app.get("/metrics", async (req, res) => {
    try {
      res.setHeader("Content-Type", prom.register.contentType || "text/plain");
      const out = await prom.register.metrics();
      res.send(out);
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error generando métricas Prometheus", details });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const stats = await statsCollector.getStats();
      res.json(stats);
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error leyendo sistema", details });
    }
  });

  app.get("/api/history", async (req, res) => {
    try {
      if (DISABLE_SQLITE) {
        res.status(503).json({ error: "Histórico no disponible (SQLite desactivado)" });
        return;
      }
      const limit = Number(req.query.limit) || 360;
      const rangeSeconds = Number(req.query.rangeSeconds) || null;
      const fromMs = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? Date.now() - rangeSeconds * 1000 : null;
      const rows = await getHistory({ limit, fromMs });
      res.json({ samples: rows });
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error leyendo histórico", details });
    }
  });
  app.get("/api/storage", async (req, res) => {
    try {
      const stats = await statsCollector.getStats();
      res.json({ storage: stats.storage });
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error leyendo storage", details });
    }
  });
  app.get("/api/storage/history", async (req, res) => {
    try {
      if (DISABLE_SQLITE) {
        res.status(503).json({ error: "Histórico de storage no disponible (SQLite desactivado)" });
        return;
      }
      const { getStorageHistory, execSql } = require("./db/sqlite");
      const deviceType = req.query.deviceType || null;
      const deviceFs = req.query.deviceFs || null;
      const limit = Number(req.query.limit) || 360;
      const rangeSeconds = Number(req.query.rangeSeconds) || null;
      const rows = await getStorageHistory({ deviceType, deviceFs, rangeSeconds, limit });
      res.json({ samples: rows });
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error leyendo histórico de storage", details });
    }
  });
  app.get("/api/export/memory.csv", async (req, res) => {
    try {
      if (DISABLE_SQLITE) {
        res.status(503).json({ error: "Export no disponible (SQLite desactivado)" });
        return;
      }
      const rangeSeconds = Number(req.query.rangeSeconds) || null;
      const fromMs = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? Date.now() - rangeSeconds * 1000 : null;
      let sql = `
        SELECT ts_ms, mem_total_mb, mem_used_mb, mem_free_mb, mem_shared_mb,
               mem_buffers_mb, mem_cached_mb, mem_buffcache_mb, mem_available_mb,
               mem_swap_total_mb, mem_swap_used_mb, mem_used_pct
        FROM metrics
      `;
      if (Number.isFinite(fromMs) && fromMs > 0) {
        sql += ` WHERE ts_ms >= ${fromMs}`;
      }
      sql += ` ORDER BY ts_ms ASC`;
      const csv = await execSql(sql);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="memory.csv"');
      const header = "ts_ms,mem_total_mb,mem_used_mb,mem_free_mb,mem_shared_mb,mem_buffers_mb,mem_cached_mb,mem_buffcache_mb,mem_available_mb,mem_swap_total_mb,mem_swap_used_mb,mem_used_pct";
      const out = "\uFEFF" + "sep=,\n" + (csv && csv.trim() ? csv : header) + "\n";
      res.send(out);
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error exportando memoria", details });
    }
  });
  app.get("/api/export/storage.csv", async (req, res) => {
    try {
      if (DISABLE_SQLITE) {
        res.status(503).json({ error: "Export no disponible (SQLite desactivado)" });
        return;
      }
      const deviceType = req.query.deviceType || null;
      const deviceFs = req.query.deviceFs || null;
      const rangeSeconds = Number(req.query.rangeSeconds) || null;
      const fromMs = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? Date.now() - rangeSeconds * 1000 : null;
      let sql = `
        SELECT ts_ms, device_fs, mount, device_type, total_bytes, used_bytes, use_percent
        FROM storage_metrics
      `;
      const where = [];
      if (deviceType) where.push(`device_type = '${String(deviceType).replace(/'/g, "''")}'`);
      if (deviceFs) where.push(`device_fs = '${String(deviceFs).replace(/'/g, "''")}'`);
      if (Number.isFinite(fromMs) && fromMs > 0) where.push(`ts_ms >= ${fromMs}`);
      if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
      sql += ` ORDER BY ts_ms ASC`;
      const csv = await execSql(sql);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="storage.csv"');
      const header = "ts_ms,device_fs,mount,device_type,total_bytes,used_bytes,use_percent";
      const out = "\uFEFF" + "sep=,\n" + (csv && csv.trim() ? csv : header) + "\n";
      res.send(out);
    } catch (error) {
      console.error(error);
      const details = NODE_ENV === "production" ? undefined : error?.message;
      res.status(500).json({ error: "Error exportando storage", details });
    }
  });

  return app;
}

module.exports = {
  createApp,
};
