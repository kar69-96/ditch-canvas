// Vercel serverless function for starting streaming auth
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // Verify external streaming server is configured
    const streamingUrl = process.env.STREAMING_SERVER_URL;

    if (!streamingUrl) {
      return res.status(500).json({
        success: false,
        error: 'Streaming server not configured'
      });
    }

    // Return proxied URL through ditchcanvas.com (NOT raw EC2 IP!)
    // This ensures users never see the backend infrastructure
    const productionUrl = 'https://ditchcanvas.com';
    const proxyUrl = `${productionUrl}/api/streaming-auth/viewer?email=${encodeURIComponent(email)}`;

    return res.json({
      success: true,
      url: proxyUrl,
      streamingServerUrl: streamingUrl, // EC2 server URL for polling extraction status
      message: 'Streaming server ready'
    });

  } catch (error) {
    console.error('Streaming auth start error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
