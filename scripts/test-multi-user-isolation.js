#!/usr/bin/env node

/**
 * Test script for multi-user session isolation
 *
 * This script:
 * 1. Starts the streaming server
 * 2. Sets up a cloudflare tunnel
 * 3. Opens 20 browser windows with unique emails
 *
 * Usage: node scripts/test-multi-user-isolation.js
 */

const { spawn, exec } = require("child_process");
const path = require("path");

const NUM_USERS = 20;
const STREAMING_PORT = 3002;

// Generate test emails
const testEmails = Array.from(
  { length: NUM_USERS },
  (_, i) => `testuser${String(i + 1).padStart(2, "0")}@colorado.edu`,
);

console.log("=".repeat(60));
console.log("Multi-User Session Isolation Test");
console.log("=".repeat(60));
console.log(`Testing with ${NUM_USERS} concurrent users\n`);

// Store process references for cleanup
let streamingProcess = null;
let tunnelProcess = null;
let tunnelUrl = null;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startStreamingServer() {
  console.log("[1/4] Starting streaming server...");

  const scriptPath = path.join(
    __dirname,
    "..",
    "src",
    "core",
    "extract-cookies-streaming.js",
  );

  streamingProcess = spawn("node", [scriptPath], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      STREAMING_PORT: String(STREAMING_PORT),
      NODE_ENV: "development",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  streamingProcess.stdout.on("data", (data) => {
    const output = data.toString();
    if (output.includes("Streaming server started")) {
      console.log(
        `      ✅ Streaming server running on port ${STREAMING_PORT}`,
      );
    }
    // Log session activity
    if (output.includes("[streaming]")) {
      process.stdout.write(`      ${output}`);
    }
  });

  streamingProcess.stderr.on("data", (data) => {
    console.error(`      [streaming error] ${data.toString()}`);
  });

  // Wait for server to start
  await sleep(3000);
  return true;
}

async function startCloudflaredTunnel() {
  console.log("\n[2/4] Starting Cloudflare tunnel...");

  return new Promise((resolve, reject) => {
    tunnelProcess = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://localhost:${STREAMING_PORT}`],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let urlFound = false;

    const handleOutput = (data) => {
      const output = data.toString();
      // Look for the tunnel URL
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !urlFound) {
        urlFound = true;
        tunnelUrl = match[0];
        console.log(`      ✅ Tunnel URL: ${tunnelUrl}`);
        resolve(tunnelUrl);
      }
    };

    tunnelProcess.stdout.on("data", handleOutput);
    tunnelProcess.stderr.on("data", handleOutput);

    tunnelProcess.on("error", (err) => {
      if (err.code === "ENOENT") {
        console.error("      ❌ cloudflared not found. Install it with:");
        console.error("         brew install cloudflared");
        reject(new Error("cloudflared not installed"));
      } else {
        reject(err);
      }
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!urlFound) {
        reject(new Error("Timeout waiting for tunnel URL"));
      }
    }, 30000);
  });
}

async function openBrowserWindows(baseUrl) {
  console.log(`\n[3/4] Opening ${NUM_USERS} browser windows...`);
  console.log("      Each window should show an INDEPENDENT login session.\n");

  const urls = testEmails.map(
    (email) => `${baseUrl}?email=${encodeURIComponent(email)}`,
  );

  // Print the URLs being opened
  console.log("      URLs being opened:");
  urls.forEach((url, i) => {
    console.log(`      ${i + 1}. ${url}`);
  });

  console.log("\n      Opening windows in batches of 5...");

  // Open in batches to avoid overwhelming the system
  for (let i = 0; i < urls.length; i += 5) {
    const batch = urls.slice(i, i + 5);

    for (const url of batch) {
      // Use 'open' command on macOS to open in default browser
      exec(`open "${url}"`, (err) => {
        if (err) {
          console.error(`      Error opening ${url}:`, err.message);
        }
      });
    }

    console.log(
      `      Opened windows ${i + 1} to ${Math.min(i + 5, urls.length)}`,
    );
    await sleep(2000); // Wait between batches
  }

  return true;
}

async function monitorHealth() {
  console.log("\n[4/4] Monitoring server health...");
  console.log("      Press Ctrl+C to stop the test\n");

  const checkHealth = async () => {
    try {
      const http = require("http");
      return new Promise((resolve) => {
        const req = http.get(
          `http://localhost:${STREAMING_PORT}/health`,
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const health = JSON.parse(data);
                console.log(`      Active sessions: ${health.activeSessions}`);
                if (health.sessions && health.sessions.length > 0) {
                  health.sessions.forEach((s) => {
                    console.log(
                      `        - ${s.email}: sockets=${s.socketCount}, complete=${s.extractionComplete}`,
                    );
                  });
                }
                resolve(health);
              } catch (e) {
                resolve(null);
              }
            });
          },
        );
        req.on("error", () => resolve(null));
        req.setTimeout(2000, () => {
          req.destroy();
          resolve(null);
        });
      });
    } catch (e) {
      return null;
    }
  };

  // Check health every 5 seconds
  const healthInterval = setInterval(async () => {
    console.log("\n      --- Health Check ---");
    await checkHealth();
  }, 5000);

  // Initial health check
  await sleep(3000);
  await checkHealth();

  return healthInterval;
}

async function cleanup() {
  console.log("\n\nCleaning up...");

  if (streamingProcess) {
    streamingProcess.kill("SIGTERM");
    console.log("  Stopped streaming server");
  }

  if (tunnelProcess) {
    tunnelProcess.kill("SIGTERM");
    console.log("  Stopped cloudflare tunnel");
  }

  process.exit(0);
}

// Handle Ctrl+C
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

async function main() {
  try {
    await startStreamingServer();
    const url = await startCloudflaredTunnel();
    await openBrowserWindows(url);
    await monitorHealth();
  } catch (err) {
    console.error("\n❌ Test failed:", err.message);
    cleanup();
  }
}

main();
