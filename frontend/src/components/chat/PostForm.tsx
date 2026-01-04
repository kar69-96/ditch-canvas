/**
 * PostForm component for creating and editing posts
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FileUpload } from './FileUpload';
import { useCreatePost, useEditPost } from '@/hooks/useChat';
import { toast } from '@/hooks/use-toast';
import type { Post, PostTag, CreatePostData, EditPostData } from '@/types/chat';

interface PostFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: number;
  initialData?: Post;
  onSuccess?: () => void;
}

export function PostForm({
  open,
  onOpenChange,
  courseId,
  initialData,
  onSuccess,
}: PostFormProps) {
  const isEditMode = !!initialData;
  const createPost = useCreatePost();
  const editPost = useEditPost();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tag, setTag] = useState<PostTag>('problem');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form with initial data if editing
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title);
      setBody(initialData.body);
      setTag(initialData.tag);
      setFiles([]); // Can't edit attachments for now
    } else {
      setTitle('');
      setBody('');
      setTag('problem');
      setFiles([]);
    }
    setErrors({});
  }, [initialData, open]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (title.length < 3) {
      newErrors.title = 'Title must be at least 3 characters';
    } else if (title.length > 200) {
      newErrors.title = 'Title must be less than 200 characters';
    }

    if (body.length < 10) {
      newErrors.body = 'Body must be at least 10 characters';
    } else if (body.length > 5000) {
      newErrors.body = 'Body must be less than 5000 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode && initialData) {
        const editData: EditPostData = {
          title,
          body,
          tag,
        };
        await editPost.mutateAsync({
          postId: initialData.id,
          data: editData,
        });
        toast({
          title: 'Post updated',
          description: 'Your post has been successfully updated.',
        });
      } else {
        const createData: CreatePostData = {
          courseId,
          title,
          body,
          tag,
          attachments: files.length > 0 ? files : undefined,
        };
        await createPost.mutateAsync(createData);
        toast({
          title: 'Post created',
          description: 'Your post has been successfully created.',
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save post',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Post' : 'Create New Post'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter post title..."
              className={errors.title ? 'border-destructive' : ''}
            />
            {errors.title && (
              <p className="text-sm text-destructive">{errors.title}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {title.length}/200 characters
            </p>
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="body">
              Question/Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enter your question or description..."
              rows={6}
              className={errors.body ? 'border-destructive' : ''}
            />
            {errors.body && (
              <p className="text-sm text-destructive">{errors.body}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {body.length}/5000 characters
            </p>
          </div>

          {/* Tag */}
          <div className="space-y-2">
            <Label>
              Tag <span className="text-destructive">*</span>
            </Label>
            <RadioGroup value={tag} onValueChange={(value) => setTag(value as PostTag)}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="problem" id="problem" />
                <Label htmlFor="problem" className="cursor-pointer">
                  Problem
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="discussion" id="discussion" />
                <Label htmlFor="discussion" className="cursor-pointer">
                  Discussion
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="other" id="other" />
                <Label htmlFor="other" className="cursor-pointer">
                  Other
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* File Upload */}
          {!isEditMode && (
            <div className="space-y-2">
              <Label>Attachments (optional)</Label>
              <FileUpload files={files} onChange={setFiles} />
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEditMode ? 'Update Post' : 'Post'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

