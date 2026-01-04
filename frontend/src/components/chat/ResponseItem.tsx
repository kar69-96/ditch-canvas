/**
 * ResponseItem component for displaying a single response
 */

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Edit, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { VoteButtons } from './VoteButtons';
import { AttachmentDisplay } from './AttachmentDisplay';
import { FileUpload } from './FileUpload';
import { useEditResponse, useDeleteResponse } from '@/hooks/useChat';
import { getCurrentUserId } from '@/services/api/chatApi';
import { toast } from '@/hooks/use-toast';
import type { ResponseWithDetails } from '@/types/chat';

interface ResponseItemProps {
  response: ResponseWithDetails;
  postId: string;
  courseId: number;
  onRespond?: () => void;
}

export function ResponseItem({
  response,
  postId,
  courseId,
  onRespond,
}: ResponseItemProps) {
  const [isOwner, setIsOwner] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editBody, setEditBody] = useState(response.body);
  const [editFiles, setEditFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const editResponseMutation = useEditResponse();
  const deleteResponseMutation = useDeleteResponse();
  const timeAgo = formatDistanceToNow(new Date(response.created_at), { addSuffix: true });

  // Check if current user is the owner
  useEffect(() => {
    const checkOwner = async () => {
      try {
        const userId = await getCurrentUserId();
        // Strict comparison: only show edit/delete if user_id matches exactly
        setIsOwner(response.user_id === userId);
      } catch (error) {
        // If we can't get user ID, user is not the owner
        setIsOwner(false);
      }
    };
    checkOwner();
  }, [response.user_id]);

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editBody.length < 10) {
      toast({
        title: 'Error',
        description: 'Response must be at least 10 characters',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await editResponseMutation.mutateAsync({
        responseId: response.id,
        data: {
          body: editBody,
          attachments: editFiles.length > 0 ? editFiles : undefined,
        },
      });
      setShowEditModal(false);
      setEditFiles([]);
      toast({
        title: 'Response updated',
        description: 'Your response has been updated successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update response',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteResponseMutation.mutateAsync(response.id);
      setShowDeleteDialog(false);
      toast({
        title: 'Response deleted',
        description: 'Your response has been deleted successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete response',
        variant: 'destructive',
      });
    }
  };

  return (
    <>
      <div className="p-4 border border-border rounded-lg bg-background">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90">
              {response.anonymous_thread_id}
            </span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs text-muted-foreground">{timeAgo}</span>
            {response.is_edited && (
              <>
                <span className="text-xs text-muted-foreground">•</span>
                <span className="text-xs text-muted-foreground italic">edited</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setEditBody(response.body);
                    setShowEditModal(true);
                  }}
                  className="h-7 w-7"
                  title="Edit response"
                >
                  <Edit className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDeleteDialog(true)}
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  title="Delete response"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
            <VoteButtons
              targetId={response.id}
              targetType="response"
              currentScore={response.net_score}
              userVote={response.user_vote || null}
            />
          </div>
        </div>

        <p className="text-foreground/90 mb-3 whitespace-pre-wrap">{response.body}</p>

        {response.attachments && response.attachments.length > 0 && (
          <AttachmentDisplay attachments={response.attachments} className="mt-3" />
        )}
      </div>

      {/* Edit Response Modal */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Response</DialogTitle>
            <DialogDescription>
              Update your response. You can modify the text and attachments.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Response
              </label>
              <Textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Write your response..."
                rows={6}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {editBody.length}/5000 characters
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Attach Files (Optional)
              </label>
              <FileUpload files={editFiles} onChange={setEditFiles} />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowEditModal(false);
                  setEditBody(response.body);
                  setEditFiles([]);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || editBody.length < 10}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Response'
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Response Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Response</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this response? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

