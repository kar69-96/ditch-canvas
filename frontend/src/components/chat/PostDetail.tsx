/**
 * PostDetail component for displaying a post with responses in the sidecar
 */

import { useState, useRef, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Edit, MessageSquare, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { ResponseList } from './ResponseList';
import { AttachmentDisplay } from './AttachmentDisplay';
import { FileUpload } from './FileUpload';
import { PostForm } from './PostForm';
import { usePost, useCreateResponse, useDeletePost, useEditPost } from '@/hooks/useChat';
import { useChatRealtime } from '@/hooks/useChatRealtime';
import { getCurrentUserId } from '@/services/api/chatApi';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { PostTag } from '@/types/chat';

interface PostDetailProps {
  postId: string;
  onEdit?: () => void;
}

const TAG_COLORS: Record<PostTag, string> = {
  problem: 'bg-blue-500/20 text-blue-500 border-blue-500/30',
  discussion: 'bg-green-500/20 text-green-500 border-green-500/30',
  other: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
};

export function PostDetail({ postId, onEdit }: PostDetailProps) {
  const { data: postData, isLoading } = usePost(postId);
  const createResponse = useCreateResponse();

  // Real-time updates for this post
  useChatRealtime({ postId, enabled: !!postId });
  const replyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [replyBody, setReplyBody] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const deletePostMutation = useDeletePost();
  const editPostMutation = useEditPost();

  // Check if current user is the owner
  useEffect(() => {
    const checkOwner = async () => {
      if (postData) {
        try {
          const userId = await getCurrentUserId();
          // Strict comparison: only show edit/delete if user_id matches exactly
          setIsOwner(postData.user_id === userId);
        } catch (error) {
          // If we can't get user ID, user is not the owner
          setIsOwner(false);
        }
      }
    };
    if (postData) {
      checkOwner();
    }
  }, [postData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!postData) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Post not found</p>
      </div>
    );
  }

  const timeAgo = formatDistanceToNow(new Date(postData.created_at), { addSuffix: true });

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();

    if (replyBody.length < 10) {
      toast({
        title: 'Error',
        description: 'Response must be at least 10 characters',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await createResponse.mutateAsync({
        postId,
        body: replyBody,
        attachments: replyFiles.length > 0 ? replyFiles : undefined,
      });
      setReplyBody('');
      setReplyFiles([]);
      setShowReplyModal(false);
      toast({
        title: 'Response posted',
        description: 'Your response has been posted successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to post response',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Post Header */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-foreground/90 mb-2">
              {postData.title}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn('text-xs capitalize', TAG_COLORS[postData.tag])}
              >
                {postData.tag}
              </Badge>
              <span className="text-sm text-muted-foreground">
                by {postData.anonymous_thread_id}
              </span>
              <span className="text-sm text-muted-foreground">•</span>
              <span className="text-sm text-muted-foreground">{timeAgo}</span>
              {postData.is_edited && (
                <>
                  <span className="text-sm text-muted-foreground">•</span>
                  <span className="text-sm text-muted-foreground italic">edited</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowEditModal(true)}
                  className="h-8 w-8"
                  title="Edit post"
                >
                  <Edit className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowDeleteDialog(true)}
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  title="Delete post"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </>
            )}
            <VoteButtons
              targetId={postData.id}
              targetType="post"
              currentScore={postData.net_score}
              userVote={postData.user_vote || null}
            />
          </div>
        </div>

        {/* Post Body */}
        <div className="prose prose-sm max-w-none">
          <p className="text-foreground/90 whitespace-pre-wrap">{postData.body}</p>
        </div>

        {/* Post Attachments */}
        {postData.attachments && postData.attachments.length > 0 && (
          <AttachmentDisplay attachments={postData.attachments} />
        )}
      </div>

      {/* Responses Section */}
      <div className="border-t border-border pt-6">
        <h3 className="text-lg font-semibold mb-4">
          {postData.response_count} {postData.response_count === 1 ? 'Response' : 'Responses'}
        </h3>

        {postData.responses && postData.responses.length > 0 ? (
          <ResponseList
            post={postData}
            responses={postData.responses.map(r => ({ ...r, attachments: [] }))}
            onRespond={() => {
              replyTextareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              replyTextareaRef.current?.focus();
            }}
          />
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p className="mb-4">No responses yet. Be the first to respond!</p>
          </div>
        )}
      </div>

      {/* Add Response Button */}
      <div className="border-t border-border pt-6">
        <Button
          onClick={() => setShowReplyModal(true)}
          className="w-full"
          variant="outline"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Response
        </Button>
      </div>

      {/* Reply Modal */}
      <Dialog open={showReplyModal} onOpenChange={setShowReplyModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Response</DialogTitle>
            <DialogDescription>
              Write your response to this post. You can attach files if needed.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitReply} className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-medium mb-2 block">
                Response
              </label>
              <Textarea
                ref={replyTextareaRef}
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                placeholder="Write your response..."
                rows={6}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {replyBody.length}/5000 characters
              </p>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block text-muted-foreground">
                Attach Files (Optional)
              </label>
              <FileUpload files={replyFiles} onChange={setReplyFiles} />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowReplyModal(false);
                  setReplyBody('');
                  setReplyFiles([]);
                }}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || replyBody.length < 10}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Posting...
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    Post Response
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Post Modal */}
      {showEditModal && postData && (
        <PostForm
          open={showEditModal}
          onOpenChange={setShowEditModal}
          courseId={postData.course_id}
          initialData={postData}
          onSuccess={() => {
            setShowEditModal(false);
            toast({
              title: 'Post updated',
              description: 'Your post has been updated successfully.',
            });
          }}
        />
      )}

      {/* Delete Post Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post? This action cannot be undone and will also delete all responses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  await deletePostMutation.mutateAsync(postId);
                  setShowDeleteDialog(false);
                  toast({
                    title: 'Post deleted',
                    description: 'Your post has been deleted successfully.',
                  });
                  // Close the sidecar by navigating away or closing
                  window.history.back();
                } catch (error: any) {
                  toast({
                    title: 'Error',
                    description: error.message || 'Failed to delete post',
                    variant: 'destructive',
                  });
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

