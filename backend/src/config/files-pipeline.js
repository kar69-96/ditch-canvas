const FILES_PIPELINE_MODE = 'strict';
const isStrictFilesPipeline = true;

function normalizeFilesPipelineMode() {
  return FILES_PIPELINE_MODE;
}

module.exports = {
  FILES_PIPELINE_MODE,
  isStrictFilesPipeline,
  normalizeFilesPipelineMode,
  ALLOWED_FILES_PIPELINE_MODES: [FILES_PIPELINE_MODE],
};

