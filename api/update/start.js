// Vercel serverless function for triggering background updates
const https = require("https");

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res
        .status(400)
        .json({ success: false, error: "Email is required" });
    }

    // Get the streaming server URL to trigger update there
    const streamingServerUrl = process.env.STREAMING_SERVER_URL;

    if (!streamingServerUrl) {
      console.log("[update] No streaming server configured, skipping update");
      return res.json({
        success: true,
        skipped: true,
        message: "Update skipped - no streaming server configured",
      });
    }

    // Trigger update on the streaming server (non-blocking)
    try {
      const updateUrl = new URL(
        "/api/streaming-auth/trigger-update",
        streamingServerUrl,
      );

      const body = JSON.stringify({ email });

      const updateReq = https.request(
        {
          hostname: updateUrl.hostname,
          port: updateUrl.port || 443,
          path: updateUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 5000, // Short timeout - we don't wait for completion
        },
        (updateRes) => {
          // We don't wait for the update to complete
          console.log(
            `[update] Triggered update on streaming server, status: ${updateRes.statusCode}`,
          );
        },
      );

      updateReq.on("error", (err) => {
        console.warn(
          `[update] Failed to trigger update on streaming server: ${err.message}`,
        );
      });

      updateReq.write(body);
      updateReq.end();

      console.log(`[update] Update trigger sent for ${email}`);
    } catch (err) {
      console.warn(`[update] Error triggering update: ${err.message}`);
    }

    // Return immediately - update runs in background on EC2
    return res.json({
      success: true,
      message: "Update triggered",
      email,
    });
  } catch (error) {
    console.error("[update] Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
