/**
 * Chat Storage Service
 * Handles file uploads and downloads for chat attachments
 */

import { supabase } from '@/lib/supabase';
import type { Attachment } from '@/types/chat';

const BUCKET_NAME = 'chat-attachments';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB
const SIGNED_URL_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Validates file size and type
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
    };
  }

  // Basic MIME type validation (whitelist approach)
  const allowedTypes = [
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    // Text
    'text/plain',
    'text/markdown',
    'text/csv',
  ];

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type ${file.type} is not allowed`,
    };
  }

  return { valid: true };
}

/**
 * Validates total size of multiple files
 */
export function validateFiles(files: File[]): { valid: boolean; error?: string } {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  
  if (totalSize > MAX_TOTAL_SIZE) {
    return {
      valid: false,
      error: `Total file size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit`,
    };
  }

  // Validate each file
  for (const file of files) {
    const validation = validateFile(file);
    if (!validation.valid) {
      return validation;
    }
  }

  return { valid: true };
}

/**
 * Uploads a file to Supabase Storage
 */
export async function uploadAttachment(
  file: File,
  courseId: number,
  postId?: string,
  responseId?: string
): Promise<{ path: string; signedUrl: string }> {
  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Generate unique path
  const attachmentId = crypto.randomUUID();
  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
  const path = `${courseId}/${postId || responseId}/${attachmentId}/${sanitizedFileName}`;

  // Upload file
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  // Generate signed URL
  const { data: urlData, error: urlError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, SIGNED_URL_EXPIRY);

  if (urlError || !urlData) {
    throw new Error(`Failed to generate signed URL: ${urlError?.message || 'Unknown error'}`);
  }

  return {
    path: data.path,
    signedUrl: urlData.signedUrl,
  };
}

/**
 * Gets a signed URL for an attachment
 */
export async function getAttachmentUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(filePath, SIGNED_URL_EXPIRY);

  if (error || !data) {
    throw new Error(`Failed to get signed URL: ${error?.message || 'Unknown error'}`);
  }

  return data.signedUrl;
}

/**
 * Gets signed URLs for multiple attachments
 */
export async function getAttachmentUrls(attachments: Attachment[]): Promise<Attachment[]> {
  const attachmentsWithUrls = await Promise.all(
    attachments.map(async (attachment) => {
      try {
        const signedUrl = await getAttachmentUrl(attachment.file_path);
        return { ...attachment, signed_url: signedUrl };
      } catch (error) {
        console.error(`Failed to get URL for attachment ${attachment.id}:`, error);
        return attachment;
      }
    })
  );

  return attachmentsWithUrls;
}

/**
 * Deletes an attachment from storage
 */
export async function deleteAttachment(filePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET_NAME).remove([filePath]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

