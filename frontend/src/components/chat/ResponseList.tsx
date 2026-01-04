/**
 * ResponseList component for displaying all responses to a post
 */

import { ResponseItem } from './ResponseItem';
import type { ResponseWithDetails, Post } from '@/types/chat';

interface ResponseListProps {
  post: Post;
  responses: ResponseWithDetails[];
  onRespond?: () => void;
}

export function ResponseList({ post, responses, onRespond }: ResponseListProps) {
  if (responses.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>No responses yet. Be the first to respond!</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {responses.map((response) => (
        <ResponseItem
          key={response.id}
          response={response}
          postId={post.id}
          courseId={post.course_id}
          onRespond={onRespond}
        />
      ))}
    </div>
  );
}

