/**
 * React Query hooks for chat functionality
 */

import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import * as chatApi from '@/services/api/chatApi';
import type {
  Post,
  PostWithResponses,
  Response,
  Filters,
  SortMode,
  CreatePostData,
  EditPostData,
  CreateResponseData,
  EditResponseData,
  VoteData,
  AccessStatus,
  UserOnboardingState,
} from '@/types/chat';

// Query key factory
export const chatKeys = {
  all: ['chat'] as const,
  courses: () => [...chatKeys.all, 'courses'] as const,
  course: (courseId: number) => [...chatKeys.courses(), courseId] as const,
  posts: (courseId: number, filters: Filters, sort: SortMode) =>
    [...chatKeys.course(courseId), 'posts', filters, sort] as const,
  post: (postId: string) => [...chatKeys.all, 'post', postId] as const,
  access: (postId: string) => [...chatKeys.post(postId), 'access'] as const,
  onboarding: (courseId: number) => [...chatKeys.course(courseId), 'onboarding'] as const,
};

/**
 * Infinite query for posts with pagination
 */
export function useChatPosts(
  courseId: number,
  filters: Filters = {},
  sort: SortMode = 'default'
) {
  return useInfiniteQuery({
    queryKey: chatKeys.posts(courseId, filters, sort),
    queryFn: async ({ pageParam = 1 }) => {
      return await chatApi.getPosts(courseId, filters, sort, pageParam, 20);
    },
    getNextPageParam: (lastPage, allPages) => {
      // If last page has fewer than 20 items, we've reached the end
      if (lastPage.length < 20) {
        return undefined;
      }
      return allPages.length + 1;
    },
    initialPageParam: 1,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Query for a single post with responses
 */
export function usePost(postId: string | null) {
  return useQuery({
    queryKey: chatKeys.post(postId || ''),
    queryFn: async () => {
      if (!postId) throw new Error('Post ID is required');
      return await chatApi.getPost(postId);
    },
    enabled: !!postId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Mutation for creating a post
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePostData) => chatApi.createPost(data),
    onSuccess: (newPost, variables) => {
      // Invalidate posts list for this course
      queryClient.invalidateQueries({
        queryKey: chatKeys.course(variables.courseId),
      });
    },
  });
}

/**
 * Mutation for editing a post
 */
export function useEditPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ postId, data }: { postId: string; data: EditPostData }) =>
      chatApi.editPost(postId, data),
    onSuccess: (updatedPost) => {
      // Invalidate the specific post
      queryClient.invalidateQueries({
        queryKey: chatKeys.post(updatedPost.id),
      });
      // Also invalidate posts list
      queryClient.invalidateQueries({
        queryKey: chatKeys.course(updatedPost.course_id),
      });
    },
  });
}

/**
 * Mutation for creating a response
 */
export function useCreateResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateResponseData) => chatApi.createResponse(data),
    onSuccess: (newResponse, variables) => {
      // Invalidate the post to refresh responses
      queryClient.invalidateQueries({
        queryKey: chatKeys.post(variables.postId),
      });
      // Also invalidate posts list to update response counts
      queryClient.invalidateQueries({
        queryKey: chatKeys.all,
      });
    },
  });
}

/**
 * Mutation for voting
 */
export function useVote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: VoteData) => chatApi.vote(data),
    onMutate: async (variables) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: chatKeys.all });

      let previousPost: PostWithResponses | undefined = undefined;
      const previousPostsLists: Map<string, any> = new Map();

      if (variables.targetType === 'post') {
        // Snapshot post detail cache
        previousPost = queryClient.getQueryData<PostWithResponses>(chatKeys.post(variables.targetId));
        
        if (previousPost) {
          const currentVote = previousPost.user_vote;
          let newScore = previousPost.net_score;
          let newUserVote: 'up' | 'down' | null = variables.voteType;

          if (currentVote === variables.voteType) {
            // Toggle off - remove vote
            newUserVote = null;
            newScore = variables.voteType === 'up' ? newScore - 1 : newScore + 1;
          } else if (currentVote) {
            // Change vote type
            newScore = variables.voteType === 'up' ? newScore + 2 : newScore - 2;
          } else {
            // New vote
            newScore = variables.voteType === 'up' ? newScore + 1 : newScore - 1;
          }

          queryClient.setQueryData<PostWithResponses>(chatKeys.post(variables.targetId), {
            ...previousPost,
            net_score: newScore,
            user_vote: newUserVote,
          });
        }

        // Snapshot and update all posts lists (infinite queries)
        queryClient.getQueriesData<{ pages: Post[][]; pageParams: number[] }>({ queryKey: chatKeys.courses(), exact: false })
          .forEach(([queryKey, data]) => {
            if (data) {
              previousPostsLists.set(JSON.stringify(queryKey), data);
              
              queryClient.setQueryData(queryKey, {
                ...data,
                pages: data.pages.map((page) =>
                  page.map((post) => {
                    if (post.id === variables.targetId) {
                      const currentVote = post.user_vote;
                      let newScore = post.net_score;
                      let newUserVote: 'up' | 'down' | null = variables.voteType;

                      if (currentVote === variables.voteType) {
                        newUserVote = null;
                        newScore = variables.voteType === 'up' ? newScore - 1 : newScore + 1;
                      } else if (currentVote) {
                        newScore = variables.voteType === 'up' ? newScore + 2 : newScore - 2;
                      } else {
                        newScore = variables.voteType === 'up' ? newScore + 1 : newScore - 1;
                      }

                      return {
                        ...post,
                        net_score: newScore,
                        user_vote: newUserVote,
                      };
                    }
                    return post;
                  })
                ),
              });
            }
          });
      }

      return { previousPost, previousPostsLists };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (variables.targetType === 'post' && context) {
        if (context.previousPost) {
          queryClient.setQueryData(chatKeys.post(variables.targetId), context.previousPost);
        }
        // Rollback posts lists
        context.previousPostsLists?.forEach((data, key) => {
          queryClient.setQueryData(JSON.parse(key), data);
        });
        // Also invalidate to get fresh data
        queryClient.invalidateQueries({
          queryKey: chatKeys.post(variables.targetId),
        });
        queryClient.invalidateQueries({
          queryKey: chatKeys.courses(),
        });
      }
    },
    onSuccess: (result, variables) => {
      // Invalidate to get fresh data from server (as backup)
      if (variables.targetType === 'post') {
        queryClient.invalidateQueries({
          queryKey: chatKeys.post(variables.targetId),
        });
        queryClient.invalidateQueries({
          queryKey: chatKeys.courses(),
        });
      } else {
        queryClient.invalidateQueries({
          queryKey: chatKeys.all,
        });
      }
    },
  });
}

/**
 * Query for access status
 */
export function usePostAccess(postId: string | null) {
  return useQuery({
    queryKey: chatKeys.access(postId || ''),
    queryFn: async () => {
      if (!postId) throw new Error('Post ID is required');
      return await chatApi.checkAccess(postId);
    },
    enabled: !!postId,
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Mutation for applying unlock
 */
export function useApplyUnlock() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => chatApi.applyUnlock(postId),
    onSuccess: (result, postId) => {
      // Invalidate access status
      queryClient.invalidateQueries({
        queryKey: chatKeys.access(postId),
      });
      // Invalidate the post to refresh responses visibility
      queryClient.invalidateQueries({
        queryKey: chatKeys.post(postId),
      });
    },
  });
}

/**
 * Query for onboarding state
 */
export function useOnboardingState(courseId: number) {
  return useQuery({
    queryKey: chatKeys.onboarding(courseId),
    queryFn: () => chatApi.getOnboardingState(courseId),
    staleTime: Infinity, // Once loaded, don't refetch
  });
}

/**
 * Mutation for marking onboarding as seen
 */
export function useMarkOnboardingSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (courseId: number) => chatApi.markOnboardingSeen(courseId),
    onSuccess: (_, courseId) => {
      // Update the query cache optimistically
      queryClient.setQueryData<UserOnboardingState | null>(
        chatKeys.onboarding(courseId),
        (old) => {
          if (!old) {
            return {
              id: '',
              user_id: '',
              course_id: courseId,
              has_seen_onboarding: true,
              seen_at: new Date().toISOString(),
            } as UserOnboardingState;
          }
          return {
            ...old,
            has_seen_onboarding: true,
            seen_at: new Date().toISOString(),
          };
        }
      );
    },
  });
}

/**
 * Mutation for deleting a post
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (postId: string) => chatApi.deletePost(postId),
    onSuccess: (_, postId) => {
      // Invalidate all queries to refresh the UI
      queryClient.invalidateQueries({
        queryKey: chatKeys.all,
      });
    },
  });
}

/**
 * Mutation for editing a response
 */
export function useEditResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ responseId, data }: { responseId: string; data: EditResponseData }) =>
      chatApi.editResponse(responseId, data),
    onSuccess: (updatedResponse, variables) => {
      // Invalidate the post to refresh responses
      // First, get the post_id from the response
      queryClient.invalidateQueries({
        queryKey: chatKeys.all,
      });
    },
  });
}

/**
 * Mutation for deleting a response
 */
export function useDeleteResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (responseId: string) => chatApi.deleteResponse(responseId),
    onSuccess: () => {
      // Invalidate all queries to refresh the UI
      queryClient.invalidateQueries({
        queryKey: chatKeys.all,
      });
    },
  });
}

