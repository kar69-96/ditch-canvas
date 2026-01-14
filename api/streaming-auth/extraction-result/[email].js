// Vercel serverless function to proxy extraction result checks to EC2
module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Extract email from URL path (Vercel dynamic route)
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required'
      });
    }

    const streamingServerUrl = process.env.STREAMING_SERVER_URL;

    if (!streamingServerUrl) {
      return res.status(500).json({
        success: false,
        error: 'Streaming server not configured'
      });
    }

    // Forward request to EC2 streaming server
    const response = await fetch(
      `${streamingServerUrl}/extraction-result/${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const data = await response.json();

    // Return the response from EC2
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('Extraction result proxy error:', error);

    // Return pending status if can't reach EC2
    return res.json({
      success: false,
      pending: true,
      message: 'Checking authentication status...'
    });
  }
};
