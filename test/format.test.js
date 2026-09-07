const assert = require("assert/strict");

const { formatBandwidth, formatUptime, parseThrottlingStatus } = require("../src/stats/format");

assert.equal(formatUptime(59), "59s");
assert.equal(formatUptime(65), "1m 5s");
assert.equal(formatUptime(3600), "1h 0m");
assert.equal(formatUptime(86400), "1d 0h 0m");

assert.equal(formatBandwidth(-10), "0.00 bps");
assert.equal(formatBandwidth(0), "0.00 bps");
assert.equal(formatBandwidth(999), "999.00 bps");
assert.equal(formatBandwidth(1_000), "1.00 Kbps");
assert.equal(formatBandwidth(1_000_000), "1.00 Mbps");
assert.equal(formatBandwidth(1_000_000_000), "1.00 Gbps");

assert.deepEqual(parseThrottlingStatus("0x0"), {
  status: "Normal",
  flags: {
    underVoltage: false,
    frequencyCapped: false,
    throttled: false,
    softTempLimit: false,
    underVoltageOccurred: false,
    frequencyCappedOccurred: false,
    throttledOccurred: false,
    softTempLimitOccurred: false,
  },
});

assert.equal(parseThrottlingStatus("0x1").status, "Undervoltage");
assert.equal(parseThrottlingStatus("0x4").status, "Throttled");

console.log("format tests passed");
