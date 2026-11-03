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
const ESP_CONNECT_TIMEOUT = 30000;

let espClient = null;
let espConnected = false;
let espConnecting = false;
let espIdleTimer = null;

const TANK_MIN_CM = 30;
const TANK_MAX_CM = 150;
const tankReadings = [];
const MAX_TANK_READINGS = 30;

const motorHistory = [];
const MAX_MOTOR_HISTORY = 30;
let motorState = "UNKNOWN";
let motorCurrentRun = null;
let motorCommandPending = false;
const MOTOR_START_PERCENTAGE = 20;
const MOTOR_STOP_PERCENTAGE = 95;

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

sensorParser.on("data", (line) => {

  line = line.trim();

  if (!line) {
    return;
  }

  if (line === "ON") {

    latestDetection = true;

    sensorData.humanDetected = true;
    sensorData.lastUpdate = Date.now();

    return;
  }

  if (line === "OFF") {

    latestDetection = false;
    latestRange = null;

    sensorData.humanDetected = false;
    sensorData.rangeCm = null;
    sensorData.lastUpdate = Date.now();

    return;
  }

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
        },

        tank: {
            device: latestTankData.device,
            distance_cm: latestTankData.distance_cm,
            percentage: latestTankData.percentage,
            lastUpdate: latestTankData.lastUpdate,
            calibration: {
                minimum_cm: TANK_MIN_CM,
                maximum_cm: TANK_MAX_CM
            }
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

// ==========================================
// MOTOR & TANK ESP8266 CONNECTION
// ==========================================

let latestTankData = {
    distance_cm: null,
    percentage: 0,
    lastUpdate: null,
    device: "tank_sensor"
};

function calculateTankPercentage(distanceCm) {

    let percentage =
        ((TANK_MAX_CM - distanceCm) /
        (TANK_MAX_CM - TANK_MIN_CM)) * 100;

    percentage = Math.max(0, Math.min(100, percentage));

    return Number(percentage.toFixed(1));
}

function formatRunningTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${hours}h ${minutes}m ${seconds}s`;
}

function setMotorState(targetState, callback = () => {}) {

    if (motorCommandPending) {
        return callback(new Error("Motor command already in progress"));
    }

    if (motorState === targetState) {
        return callback(null);
    }

    motorCommandPending = true;

    const command = targetState === "ON"
        ? "A0 01 01 A2"
        : "A0 01 00 A1";

    sendRelayCommand(command, (err) => {

        motorCommandPending = false;

        if (err) {
            console.error("Motor relay command failed:", err);
            return callback(err);
        }

        const now = new Date();

        if (targetState === "ON") {

            motorCurrentRun = {
                startTime: now.toISOString(),
                endTime: null,
                runningTimeMs: null,
                runningTime: null
            };

        } else {

            if (motorCurrentRun) {

                const start = new Date(motorCurrentRun.startTime);
                const duration = now.getTime() - start.getTime();

                const completedRun = {
                    startTime: motorCurrentRun.startTime,
                    endTime: now.toISOString(),
                    runningTimeMs: duration,
                    runningTime: formatRunningTime(duration)
                };

                motorHistory.unshift(completedRun);

                if (motorHistory.length > MAX_MOTOR_HISTORY) {
                    motorHistory.pop();
                }

                motorCurrentRun = null;
            }
        }

        motorState = targetState;

        console.log(`Motor turned ${targetState}`);

        callback(null);
    });
}

function turnRelayOn(callback) {
    setMotorState("ON", callback);
}

function turnRelayOff(callback) {
    setMotorState("OFF", callback);
}

function Relaystatus(callback) {
    sendRelayCommand("FF", callback)
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

app.post("/api/tank/distance", (req, res) => {

    try {

        const { device, distance_cm } = req.body;

        if (
            typeof distance_cm !== "number" ||
            !Number.isFinite(distance_cm) ||
            distance_cm < 0
        ) {
            return res.status(400).json({
                ok: false,
                error: "Invalid distance_cm"
            });
        }

        const reading = {
            device: device || "tank_sensor",

            distance_cm: Number(distance_cm.toFixed(2)),

            percentage: calculateTankPercentage(distance_cm),

            lastUpdate: new Date().toISOString()
        };

        // Store latest reading
        latestTankData = reading;

        // Store reading history
        tankReadings.push(reading);

        if (tankReadings.length > MAX_TANK_READINGS) {
            tankReadings.shift();
        }

        evaluateTankMotorControl(latestTankData.percentage);

        res.json({
            ok: true,
            reading: latestTankData
        });

    } catch (error) {

        console.error("Tank sensor error:", error);

        res.status(500).json({
            ok: false,
            error: "Server error"
        });

    }

});

app.get('/motorrelay/status', (req, res) => {
  Relaystatus((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, message: 'Relay status got successfully' });
  });
});

app.get('/motorrelay/on', (req, res) => {

    turnRelayOn((err) => {

        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            message: "Motor turned ON successfully"
        });

    });

});

app.get('/motorrelay/off', (req, res) => {

    turnRelayOff((err) => {

        if (err) {
            return res.status(500).json({
                success: false,
                error: err.message
            });
        }

        res.json({
            success: true,
            message: "Motor turned OFF successfully"
        });

    });

});

app.get('/motorrelay/history', (req, res) => {

    res.json({
        success: true,
        motorStatus: motorState,

        currentRun: motorCurrentRun ? {
            ...motorCurrentRun,
            runningTimeMs:
                Date.now() - new Date(motorCurrentRun.startTime).getTime(),

            runningTime: formatRunningTime(
                Date.now() - new Date(motorCurrentRun.startTime).getTime()
            )
        } : null,

        totalRecords: motorHistory.length,
        history: motorHistory
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
