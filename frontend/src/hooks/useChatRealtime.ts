/**
 * Real-time subscription hook for chat updates
 */

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { chatKeys } from './useChat';

interface UseChatRealtimeOptions {
  courseId?: number;
  postId?: string;
  enabled?: boolean;
}

export function useChatRealtime({ courseId, postId, enabled = true }: UseChatRealtimeOptions) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const subscriptions: Array<{ channel: any; unsubscribe: () => void }> = [];

    // Subscribe to posts changes for the course
    if (courseId) {
      const postsChannel = supabase
        .channel(`chat-posts-${courseId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_posts',
            filter: `course_id=eq.${courseId}`,
          },
          (payload) => {
            // Invalidate posts queries for this course
            queryClient.invalidateQueries({
              queryKey: chatKeys.course(courseId),
            });
          }
        )
        .subscribe();

      subscriptions.push({
        channel: postsChannel,
        unsubscribe: () => {
          supabase.removeChannel(postsChannel);
        },
      });
    }

    // Subscribe to responses for a specific post
    if (postId) {
      const responsesChannel = supabase
        .channel(`chat-responses-${postId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_responses',
            filter: `post_id=eq.${postId}`,
          },
          (payload) => {
            // Invalidate the specific post query
            queryClient.invalidateQueries({
              queryKey: chatKeys.post(postId),
            });
          }
        )
        .subscribe();

      subscriptions.push({
        channel: responsesChannel,
        unsubscribe: () => {
          supabase.removeChannel(responsesChannel);
        },
      });

      // Subscribe to votes for this post and its responses
      const votesChannel = supabase
        .channel(`chat-votes-${postId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'chat_votes',
            filter: `target_id=eq.${postId}`,
          },
          (payload) => {
            queryClient.invalidateQueries({
              queryKey: chatKeys.post(postId),
            });
          }
        )
        .subscribe();

      subscriptions.push({
        channel: votesChannel,
        unsubscribe: () => {
          supabase.removeChannel(votesChannel);
        },
      });
    }

    // Cleanup subscriptions on unmount
    return () => {
      subscriptions.forEach((sub) => sub.unsubscribe());
    };
  }, [courseId, postId, enabled, queryClient]);
}

