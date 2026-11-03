const express = require("express");
const net = require('net');
const { NODE_ENV, PUBLIC_DIR, METRICS_INTERVAL_MS, DISABLE_SQLITE } = require("./config");
const { createStatsCollector } = require("./stats");
const { initDatabase, getHistory, execSql } = require("./db/sqlite");
const { createMetricsRecorder } = require("./metrics/recorder");
const { createPrometheusMetrics } = require("./metrics/prometheus");
const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");

function createApp() {
  const app = express();
  const statsCollector = createStatsCollector();
  const prom = createPrometheusMetrics(statsCollector, { intervalMs: METRICS_INTERVAL_MS });
  const { execFile } = require("child_process");
  let gpio17Busy = false;

  if (!DISABLE_SQLITE) {
    initDatabase();
    const recorder = createMetricsRecorder(statsCollector, { intervalMs: METRICS_INTERVAL_MS, onSample: prom.updateFromSample });
    recorder.start();
  }
  if (DISABLE_SQLITE) {
    prom.start();
  }

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// TODO: Replace with your ESP8266's actual IP address assigned by your router
const MOTOR_ESP_IP = '192.168.1.7'; 
const MOTOR_ESP_PORT = 8080;
const ESP_IDLE_TIMEOUT = 2 * 60 * 1000; // 2 minutes
const ESP_CONNECT_TIMEOUT = 5000;

let espClient = null;
let espConnected = false;
let espConnecting = false;
let espIdleTimer = null;

// ==========================================
// HMMd S3KM1110 SENSOR
// ==========================================

const sensorData = {
  humanDetected: false,
  rangeCm: null,
  lastUpdate: null
};

let latestRange = null;
let latestDetection = false;


// ==========================================
// OPEN SENSOR UART
// ==========================================

const sensorPort = new SerialPort({
  path: "/dev/ttyAMA0",
  baudRate: 115200,
  autoOpen: true
});

const sensorParser = sensorPort.pipe(
  new ReadlineParser({
    delimiter: "\r\n"
  })
);


// ==========================================
// READ SENSOR UART
// ==========================================

sensorParser.on("data", (line) => {

  line = line.trim();

  if (!line) {
    return;
  }

  // -----------------------------
  // HUMAN DETECTED
  // -----------------------------

  if (line === "ON") {

    latestDetection = true;

    sensorData.humanDetected = true;
    sensorData.lastUpdate = Date.now();

    return;
  }


  // -----------------------------
  // HUMAN NOT DETECTED
  // -----------------------------

  if (line === "OFF") {

    latestDetection = false;
    latestRange = null;

    sensorData.humanDetected = false;
    sensorData.rangeCm = null;
    sensorData.lastUpdate = Date.now();

    return;
  }


  // -----------------------------
  // RANGE
  // Example: Range 113
  // -----------------------------

  const match = line.match(/^Range\s+(\d+)$/);

  if (match) {

    const value = Number(match[1]);

    if (value >= 0 && value <= 500) {

      latestRange = value;

      sensorData.rangeCm = value;
      sensorData.lastUpdate = Date.now();

    }
  }
});

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
app.get("/restartserver", (req, res) => {
  // Send response before restarting the service
  res.json({
    success: true,
    message: "Server restarting..."
  });

  setTimeout(() => {
    exec("sudo -n /usr/bin/systemctl restart system-monitor", (error, stdout, stderr) => {
      if (error) {
        console.error("Restart failed:", error);
        console.error("stderr:", stderr);
      }
    });
  }, 500);
});

// ==========================================
// SENSOR API
// ==========================================

app.get("/api/sensor", (req, res) => {

  res.json(sensorData);

});
// ===============================
// Tank Sensor
// ===============================

const tankReadings = [];
const MAX_TANK_READINGS = 30;

// Receive distance from ESP8266
app.post("/api/tank/distance", (req, res) => {
    try {
        const { device, distance_cm } = req.body;

        if (typeof distance_cm !== "number" || !isFinite(distance_cm)) {
            return res.status(400).json({
                ok: false,
                error: "Invalid distance_cm"
            });
        }

        const reading = {
            device: device || "tank_sensor",
            distance_cm: Number(distance_cm.toFixed(2)),
        };

        // Add newest reading
        tankReadings.push(reading);

        // Keep only last 30
        if (tankReadings.length > MAX_TANK_READINGS) {
            tankReadings.shift();
        }

        res.json({
            ok: true,
            reading
        });

    } catch (error) {
        console.error("Tank sensor error:", error);

        res.status(500).json({
            ok: false,
            error: "Server error"
        });
    }
});
// Return tank statistics
app.get("/api/tank/stats", (req, res) => {

    const readings = tankReadings;

    if (readings.length === 0) {
        return res.json({
            ok: true,
            count: 0,
            latest: null,
            average: null,
            minimum: null,
            maximum: null,
            readings: []
        });
    }

    const distances = readings.map(r => r.distance_cm);

    const sum = distances.reduce((a, b) => a + b, 0);

    res.json({
        ok: true,

        count: readings.length,

        latest: readings[readings.length - 1],

        average: Number((sum / distances.length).toFixed(2)),

        minimum: Math.min(...distances),

        maximum: Math.max(...distances),

        readings: readings
    });
});
app.get("/gpio17", (req, res) => {
    if (gpio17Busy) {
        return res.status(409).json({
            success: false,
            error: "GPIO17 is already pulsing"
        });
    }

    gpio17Busy = true;

    execFile("pinctrl", ["set", "17", "op", "dh"], (error) => {
        if (error) {
            gpio17Busy = false;
            console.error(error);
            return res.status(500).json({
                success: false,
                error: error.message
            });
        }

        setTimeout(() => {
            execFile("pinctrl", ["set", "17", "op", "dl"], (error) => {
                gpio17Busy = false;

                if (error) {
                    console.error(error);
                    return res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }

                res.json({
                    success: true,
                    gpio: 17,
                    pulse_ms: 500,
                    state: "LOW"
                });
            });
        }, 500);
    });
  });
app.get("/api/netrunner", (req, res) => {

    keepEspConnectionAlive();

    // ==========================================
    // 1. DEFAULT RESPONSE
    // ==========================================

    const response = {
        success: true,

        netrunner: {
            device: "netrunner",
            connected: false,
            found: false,
            ip: null,
            hostname: null,
            lastSeen: null
        },

        sensor: {
            humanDetected: sensorData.humanDetected,
            rangeCm: sensorData.rangeCm,
            lastUpdate: sensorData.lastUpdate
        }
    };


    // ==========================================
    // 2. GET TAILSCALE STATUS
    // ==========================================

    execFile("tailscale", ["status", "--json"], (error, stdout, stderr) => {

        if (error) {

            console.error("Tailscale error:", error);

            // Do NOT return 500.
            // Keep default Netrunner data.
            // Other data can still be returned.

            response.netrunner.error = "Unable to check Tailscale status";

            return res.json(response);
        }


        // ==========================================
        // 3. PARSE TAILSCALE DATA
        // ==========================================

        try {

            const status = JSON.parse(stdout);

            const peers = Object.values(status.Peer || {});

            const netrunner = peers.find(peer => {

                return (
                    peer.HostName?.toLowerCase() === "netrunner" ||
                    peer.DNSName?.toLowerCase().startsWith("netrunner.")
                );

            });


            // ==========================================
            // 4. UPDATE NETRUNNER DATA
            // ==========================================

            if (netrunner) {

                response.netrunner = {
                    device: "netrunner",
                    connected: netrunner.Online === true,
                    found: true,
                    ip: netrunner.TailscaleIPs?.[0] || null,
                    hostname: netrunner.HostName,
                    lastSeen: netrunner.LastSeen || null
                };

            }


        } catch (parseError) {

            console.error(
                "Tailscale JSON parse error:",
                parseError
            );

            response.netrunner.error = "Invalid Tailscale response";

        }


        // ==========================================
        // 5. FINAL RESPONSE
        // ==========================================

        return res.json(response);

    });

});

function keepEspConnectionAlive() {

    // Reset the 2-minute inactivity timer
    clearTimeout(espIdleTimer);

    // Already connected or connecting
    if (espConnected || espConnecting) {
        scheduleEspDisconnect();
        return;
    }

    console.log("Connecting to ESP8266...");

    const client = new net.Socket();

    espClient = client;
    espConnecting = true;

    // Do NOT use client.setTimeout() here.
    // An idle TCP connection is expected.

    client.connect(MOTOR_ESP_PORT, MOTOR_ESP_IP, () => {

        if (espClient !== client) return;

        espConnecting = false;
        espConnected = true;

        console.log("ESP8266 TCP connected:", MOTOR_ESP_IP);

        scheduleEspDisconnect();

    });

    client.on("data", (data) => {

        console.log(
            "ESP Response:",
            data.toString("utf8").trim()
        );

    });

    client.on("error", (err) => {

        console.error("ESP TCP Error:", err.message);

    });

    client.on("close", () => {

        if (espClient !== client) return;

        console.log("ESP8266 TCP connection closed");

        espClient = null;
        espConnected = false;
        espConnecting = false;

    });

    // Protect against a connection attempt that never completes
    const connectionTimer = setTimeout(() => {

        if (espClient === client && !espConnected) {

            console.log("ESP connection establishment timed out");

            client.destroy();

        }

    }, 5000);

    client.once("connect", () => {
        clearTimeout(connectionTimer);
    });

}



// ==========================================
// 2-MINUTE INACTIVITY TIMER
// ==========================================

function scheduleEspDisconnect() {

    clearTimeout(espIdleTimer);

    espIdleTimer = setTimeout(() => {

        console.log("ESP8266 idle for 2 minutes. Disconnecting...");

        if (espClient) {
            espClient.destroy();
        }

        espClient = null;
        espConnected = false;
        espConnecting = false;

    }, ESP_IDLE_TIMEOUT);

}


function sendRelayCommand(hexString, callback) {

    if (!espConnected || !espClient || !espClient.writable) {

        return callback(new Error("ESP8266 is not connected"));

    }

    const buffer = Buffer.from(
        hexString.replace(/\s+/g, ""),
        "hex"
    );

    espClient.write(buffer, (err) => {

        if (err) {
            return callback(err);
        }

        callback(null);

    });

}

function turnRelayOn(callback) {
    sendRelayCommand("A0 01 01 A2", callback);
}

function turnRelayOff(callback) {
    sendRelayCommand("A0 01 00 A1", callback);
}

function Relaystatus(callback) {
    sendRelayCommand("FF", callback);
}

app.get('/motorrelay/status', (req, res) => {
  Relaystatus((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, message: 'Relay status got successfully' });
  });
});

// Express API endpoint for ON
app.get('/motorrelay/on', (req, res) => {
  turnRelayOn((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, message: 'Relay turned ON successfully' });
  });
});

// Express API endpoint for OFF
app.get('/motorrelay/off', (req, res) => {
  turnRelayOff((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, message: 'Relay turned OFF successfully' });
  });
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

  return app;
}

module.exports = {
  createApp,
};
