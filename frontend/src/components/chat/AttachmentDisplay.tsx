/**
 * AttachmentDisplay component for displaying post/response attachments
 */

import { FileText, Download, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Attachment } from '@/types/chat';

interface AttachmentDisplayProps {
  attachments: Attachment[];
  className?: string;
}

const isImage = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

export function AttachmentDisplay({ attachments, className }: AttachmentDisplayProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={cn('space-y-2', className)}>
      {attachments.map((attachment) => {
        if (isImage(attachment.mime_type) && attachment.signed_url) {
          return (
            <div key={attachment.id} className="relative group">
              <img
                src={attachment.signed_url}
                alt={attachment.file_name}
                className="max-w-full h-auto rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => window.open(attachment.signed_url, '_blank')}
              />
            </div>
          );
        }

        return (
          <div
            key={attachment.id}
            className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg hover:bg-accent/50 transition-colors"
          >
            <FileText className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {attachment.file_name}
              </p>
              <p className="text-xs text-muted-foreground">
                {(attachment.file_size / 1024).toFixed(1)} KB
              </p>
            </div>
            {attachment.signed_url && (
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0"
                onClick={() => window.open(attachment.signed_url, '_blank')}
              >
                <Download className="w-4 h-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

