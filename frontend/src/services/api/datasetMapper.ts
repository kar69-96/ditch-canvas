/**
 * Maps user emails to their corresponding dataset folders
 * Each user's email maps to a dataset folder in the root directory
 */

export interface DatasetMapping {
  email: string;
  datasetPath: string;
  datasetName: string;
}

// Map of email addresses to their dataset folders
const EMAIL_TO_DATASET_MAP: Record<string, DatasetMapping> = {
  'kare6625@colorado.edu': {
    email: 'kare6625@colorado.edu',
    datasetPath: 'mock-data/extraction-data/sample_data',
    datasetName: 'sample_data'
  },
  // Add more mappings as needed
  // 'another@university.edu': {
  //   email: 'another@university.edu',
  //   datasetPath: 'another_dataset',
  //   datasetName: 'another_dataset'
  // }
};

/**
 * Get the dataset path for a given email
 * @param email User's email address
 * @returns Dataset mapping or null if not found
 */
export function getDatasetForEmail(email: string): DatasetMapping | null {
  if (!email) {
    console.warn('[datasetMapper] No email provided');
    return null;
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[datasetMapper] Looking up dataset for email: ${normalizedEmail}`);
  console.log(`[datasetMapper] Available mappings:`, Object.keys(EMAIL_TO_DATASET_MAP));
  
  const mapping = EMAIL_TO_DATASET_MAP[normalizedEmail];
  if (mapping) {
    console.log(`[datasetMapper] Found mapping: ${mapping.datasetPath}`);
  } else {
    console.warn(`[datasetMapper] No mapping found for: ${normalizedEmail}`);
  }
  
  return mapping || null;
}

/**
 * Get all available dataset mappings
 */
export function getAllDatasetMappings(): DatasetMapping[] {
  return Object.values(EMAIL_TO_DATASET_MAP);
}

/**
 * Check if a dataset exists for the given email
 */
export function hasDataset(email: string): boolean {
  return getDatasetForEmail(email) !== null;
}

