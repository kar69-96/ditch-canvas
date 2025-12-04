require('dotenv').config();

function getRequiredEnv(name, value) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBrowserbaseConfig(overrides = {}) {
  const apiKey = overrides.apiKey || process.env.BROWSERBASE_API_KEY;
  const projectId = overrides.projectId || process.env.BROWSERBASE_PROJECT_ID;
  const canvasUrl =
    overrides.canvasUrl ||
    process.env.CANVAS_LOGIN_URL ||
    'https://canvas.colorado.edu/login';

  return {
    apiKey: getRequiredEnv('BROWSERBASE_API_KEY', apiKey),
    projectId: getRequiredEnv('BROWSERBASE_PROJECT_ID', projectId),
    canvasUrl,
  };
}

module.exports = {
  getBrowserbaseConfig,
};
