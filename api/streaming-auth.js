// Vercel serverless function for streaming auth
const streamingAuthRoutes = require('../src/routes/streaming-auth');

module.exports = (req, res) => {
  // Set up CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Handle the request using the streaming-auth router
  streamingAuthRoutes(req, res);
};
