# 📊 Raspberry Pi System Monitor

A lightweight, real-time system monitoring dashboard for Raspberry Pi. This web application provides a clean, dark-themed interface to monitor your Raspberry Pi's vital statistics including CPU load, memory usage, temperature, network bandwidth, and throttling status.

![System Monitor](https://img.shields.io/badge/Node.js-Express-green)
![License](https://img.shields.io/badge/license-ISC-blue)

## ✨ Features

- **📈 Real-time Monitoring**: Auto-refreshes every 3 seconds
- **🧠 CPU Metrics**: Load averages (1, 5, and 15 minutes)
- **🧮 Memory Usage**: RAM consumption tracking
- **🌡️ Temperature Monitoring**: Both CPU and GPU temperatures
- **💾 Disk Usage**: Storage capacity and usage
- **🌐 Network Bandwidth**: Real-time download/upload speeds per interface
- **📍 IP Address Display**: Public IP and local IPv4/IPv6 addresses
- **⚡ Throttling Detection**: Monitors undervoltage and thermal throttling
- **⏱️ System Uptime**: Formatted uptime display

## 🚀 Getting Started

### Prerequisites

- Raspberry Pi (any model)
- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd system-monitor
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open your browser and navigate to:

```
http://localhost:3000
```

Or access it from another device on your network:

```
http://<raspberry-pi-ip>:3000
```

## 🛠️ Technical Details

### Architecture

- **Backend**: Node.js with Express.js
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **API**: RESTful endpoint at `/api/stats`
- **Structure**:
  - `index.js`: server entrypoint
  - `src/app.js`: Express app + routes
  - `src/stats/`: stats collection and formatting
  - `src/config.js`: environment configuration

### Monitored Metrics

| Metric       | Source                                              | Description                                |
| ------------ | --------------------------------------------------- | ------------------------------------------ |
| CPU Load     | `os.loadavg()`                                      | 1, 5, and 15-minute load averages          |
| Memory       | `os.totalmem()`, `os.freemem()`                     | Total and used RAM                         |
| Temperature  | `/sys/class/thermal/thermal_zone0/temp`, `vcgencmd` | CPU and GPU temperatures                   |
| Disk         | `df -h`                                             | Root partition usage                       |
| Network      | `/proc/net/dev`                                     | Real-time bandwidth per interface          |
| Throttling   | `vcgencmd get_throttled`                            | Undervoltage and thermal throttling status |
| IP Addresses | `os.networkInterfaces()`, `api.ipify.org`           | Local and public IP addresses              |
| Uptime       | `os.uptime()`                                       | System uptime                              |

### API Endpoint

**GET** `/api/stats`

Returns a JSON object with all system metrics:

```json
{
  "cpu": {
    "load1min": "0.52",
    "load5min": "0.48",
    "load15min": "0.45"
  },
  "uptime": {
    "seconds": 86400,
    "formatted": "1d 0h 0m"
  },
  "memory": {
    "total": "3964",
    "used": "1250"
  },
  "disk": {
    "used": "45%",
    "size": "30G"
  },
  "temperature": {
    "cpu": "45.2°C",
    "gpu": "44.0°C"
  },
  "network": {
    "bandwidth": {
      "eth0": {
        "rx": "1.25 Mbps",
        "tx": "0.85 Mbps"
      }
    }
  },
  "ipAddresses": {
    "public": "203.0.113.42",
    "local": {
      "ipv4": [{ "interface": "eth0", "address": "192.168.1.100" }],
      "ipv6": []
    }
  },
  "throttling": {
    "status": "Normal",
    "flags": {
      "underVoltage": false,
      "frequencyCapped": false,
      "throttled": false,
      "softTempLimit": false
    }
  }
}
```

## 🎨 UI Features

- **Dark Theme**: Easy on the eyes for 24/7 monitoring
- **Responsive Layout**: Adapts to different screen sizes
- **Color-Coded Alerts**:
  - 🟢 Green: Normal operation
  - 🟠 Orange: Warning conditions
  - 🔴 Red: Critical issues (throttling, undervoltage)

## 📝 Configuration

The server runs on port `3000` by default. Override settings with environment variables:

```bash
PORT=4000 npm start
```

Available environment variables:

- `PORT`: HTTP server port (default: `3000`)
- `COMMAND_TIMEOUT_MS`: timeout for shell commands like `vcgencmd`/`df` (default: `2000`)
- `PUBLIC_IP_TIMEOUT_MS`: timeout for public IP lookup (default: `3000`)

## 🔧 Troubleshooting

### Temperature readings show 0°C

Ensure you're running on a Raspberry Pi with proper thermal sensors. The application uses:

- `/sys/class/thermal/thermal_zone0/temp` for CPU
- `vcgencmd measure_temp` for GPU

### Network bandwidth shows "Collecting data..."

The bandwidth calculation requires at least two data points. Wait for the next refresh cycle (3 seconds).

### Public IP shows "Unable to fetch"

This can happen if:

- The Pi doesn't have internet connectivity
- The ipify.org API is unreachable
- The request times out (3-second timeout)

## 🤝 Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## 📄 License

ISC

## 🙏 Acknowledgments

- Uses [ipify.org](https://www.ipify.org/) for public IP detection
- Built with Express.js
- Designed for Raspberry Pi OS

---

**Note**: This application is specifically designed for Raspberry Pi and uses Pi-specific commands (`vcgencmd`). It may not work correctly on other systems.
