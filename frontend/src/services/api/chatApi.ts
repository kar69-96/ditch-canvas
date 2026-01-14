/**
 * Chat API Service
 * Handles all database operations for the anonymous class discussion forum
 */

import { supabase } from "@/lib/supabase";
import { uploadAttachment, getAttachmentUrls } from "./chatStorage";
import type {
  Post,
  Response,
  Attachment,
  PostWithResponses,
  ResponseWithDetails,
  AccessStatus,
  Filters,
  SortMode,
  CreatePostData,
  EditPostData,
  CreateResponseData,
  EditResponseData,
  VoteData,
  UserOnboardingState,
} from "@/types/chat";
import { getCurrentUser } from "../mockApi/auth";

/**
 * Helper: Get current user's Supabase user ID
 * Returns the user ID from the authenticated user
 */
export async function getCurrentUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user?.id) {
    throw new Error("User not authenticated");
  }

  return user.id;
}

/**
 * Helper: Calculate sort score for default sorting (50% recency + 50% response count)
 */
function calculateSortScore(post: Post): number {
  const now = Date.now();
  const postTime = new Date(post.created_at).getTime();
  const daysSinceCreation = (now - postTime) / (1000 * 60 * 60 * 24);

  // Recency score: More recent = higher (inverse of days, normalized 0-1)
  const recencyScore = Math.max(0, 1 - daysSinceCreation / 30); // 30 day window

  // Response count score: Normalized 0-1 (max assumed 50 responses)
  const maxResponses = 50;
  const responseScore = Math.min(1, post.response_count / maxResponses);

  // Weighted combination
  const finalScore = 0.5 * recencyScore + 0.5 * responseScore;

  return finalScore;
}

/**
 * Get posts for a course with filtering, sorting, and pagination
 */
export async function getPosts(
  courseId: number,
  filters: Filters = {},
  sort: SortMode = "default",
  page: number = 1,
  pageSize: number = 20,
): Promise<Post[]> {
  const userId = await getCurrentUserId();

  let query = supabase.from("chat_posts").select("*").eq("course_id", courseId);

  // Apply tag filter
  if (filters.tag && filters.tag.length > 0) {
    query = query.in("tag", filters.tag);
  }

  // Apply search filter (full-text search on title)
  if (filters.search && filters.search.trim()) {
    query = query.textSearch("title", filters.search.trim(), {
      type: "websearch",
      config: "english",
    });
  }

  // Apply sorting
  if (sort === "newest") {
    query = query.order("created_at", { ascending: false });
  } else if (sort === "responses") {
    query = query
      .order("response_count", { ascending: false })
      .order("created_at", { ascending: false });
  } else if (sort === "score") {
    query = query
      .order("net_score", { ascending: false })
      .order("created_at", { ascending: false });
  } else {
    // Default: Sort by created_at first, then we'll sort by score in JS
    query = query.order("created_at", { ascending: false });
  }

  // Pagination
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch posts: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  // Get user's votes on all posts
  const postIds = data.map((p) => p.id);
  const { data: votes } =
    postIds.length > 0
      ? await supabase
          .from("chat_votes")
          .select("target_id, vote_type")
          .eq("user_id", userId)
          .in("target_id", postIds)
          .eq("target_type", "post")
      : { data: [] };

  const voteMap = new Map(
    (votes || []).map((v) => [v.target_id, v.vote_type as "up" | "down"]),
  );

  // Attach user votes to posts
  const postsWithVotes = data.map((post) => ({
    ...post,
    user_vote: voteMap.get(post.id) || null,
  }));

  // For default sort, calculate scores and sort
  if (sort === "default") {
    const postsWithScores = postsWithVotes.map((post) => ({
      post,
      score: calculateSortScore(post as Post),
    }));
    postsWithScores.sort((a, b) => b.score - a.score);
    return postsWithScores.map((item) => item.post as Post);
  }

  return postsWithVotes as Post[];
}

/**
 * Get a single post with all responses and attachments
 */
export async function getPost(postId: string): Promise<PostWithResponses> {
  const userId = await getCurrentUserId();

  // Fetch post
  const { data: postData, error: postError } = await supabase
    .from("chat_posts")
    .select("*")
    .eq("id", postId)
    .single();

  if (postError || !postData) {
    throw new Error(
      `Failed to fetch post: ${postError?.message || "Post not found"}`,
    );
  }

  // Fetch responses (sorted by net_score DESC)
  const { data: responsesData, error: responsesError } = await supabase
    .from("chat_responses")
    .select("*")
    .eq("post_id", postId)
    .order("net_score", { ascending: false })
    .order("created_at", { ascending: true }); // Tie-breaker: older first

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  // Fetch attachments for post
  const { data: postAttachments } = await supabase
    .from("chat_attachments")
    .select("*")
    .eq("post_id", postId)
    .order("display_order", { ascending: true });

  // Fetch attachments for responses
  const responseIds = (responsesData || []).map((r) => r.id);
  const { data: responseAttachments } =
    responseIds.length > 0
      ? await supabase
          .from("chat_attachments")
          .select("*")
          .in("response_id", responseIds)
          .order("display_order", { ascending: true })
      : { data: [] };

  // Get user's vote on the post
  const { data: postVote } = await supabase
    .from("chat_votes")
    .select("vote_type")
    .eq("user_id", userId)
    .eq("target_id", postId)
    .eq("target_type", "post")
    .single();

  // Get user's votes on responses
  const { data: responseVotes } =
    responseIds.length > 0
      ? await supabase
          .from("chat_votes")
          .select("target_id, vote_type")
          .eq("user_id", userId)
          .in("target_id", responseIds)
          .eq("target_type", "response")
      : { data: [] };

  const voteMap = new Map(
    (responseVotes || []).map((v) => [
      v.target_id,
      v.vote_type as "up" | "down",
    ]),
  );

  // Attach attachments and votes to responses
  const responsesWithDetails: ResponseWithDetails[] = (responsesData || []).map(
    (response) => ({
      ...response,
      attachments: (responseAttachments || []).filter(
        (a) => a.response_id === response.id,
      ),
      user_vote: voteMap.get(response.id) || null,
    }),
  ) as ResponseWithDetails[];

  // Get signed URLs for attachments
  const postAttachmentsWithUrls = postAttachments
    ? await getAttachmentUrls(postAttachments as Attachment[])
    : [];

  const responsesWithUrls = await Promise.all(
    responsesWithDetails.map(async (response) => ({
      ...response,
      attachments: await getAttachmentUrls(response.attachments),
    })),
  );

  return {
    ...(postData as Post),
    responses: responsesWithUrls,
    attachments: postAttachmentsWithUrls,
    user_vote: (postVote?.vote_type as "up" | "down") || null,
  };
}

/**
 * Create a new post
 */
export async function createPost(data: CreatePostData): Promise<Post> {
  const userId = await getCurrentUserId();

  // Validate inputs
  if (data.title.length < 3 || data.title.length > 200) {
    throw new Error("Title must be between 3 and 200 characters");
  }
  if (data.body.length < 10 || data.body.length > 5000) {
    throw new Error("Body must be between 10 and 5000 characters");
  }
  if (!["problem", "discussion", "other"].includes(data.tag)) {
    throw new Error("Invalid tag");
  }

  // Generate fruit name using database function
  const { data: fruitData, error: fruitError } = await supabase.rpc(
    "generate_fruit_name",
  );
  if (fruitError || !fruitData) {
    throw new Error(
      `Failed to generate fruit name: ${fruitError?.message || "Unknown error"}`,
    );
  }
  const fruitName = fruitData as string;

  // Upload attachments if provided
  const attachmentRecords: Omit<
    Attachment,
    "id" | "created_at" | "signed_url"
  >[] = [];
  if (data.attachments && data.attachments.length > 0) {
    for (let i = 0; i < data.attachments.length; i++) {
      const file = data.attachments[i];
      const { path, signedUrl } = await uploadAttachment(file, data.courseId);

      attachmentRecords.push({
        post_id: null, // Will be set after post creation
        response_id: null,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        display_order: i,
      });
    }
  }

  // Create post
  const { data: postData, error: postError } = await supabase
    .from("chat_posts")
    .insert({
      course_id: data.courseId,
      user_id: userId,
      anonymous_thread_id: fruitName,
      title: data.title,
      body: data.body,
      tag: data.tag,
    })
    .select()
    .single();

  if (postError || !postData) {
    throw new Error(
      `Failed to create post: ${postError?.message || "Unknown error"}`,
    );
  }

  // Create attachment records
  if (attachmentRecords.length > 0) {
    const attachmentsToInsert = attachmentRecords.map((att) => ({
      ...att,
      post_id: postData.id,
    }));

    const { error: attachError } = await supabase
      .from("chat_attachments")
      .insert(attachmentsToInsert);

    if (attachError) {
      console.error("Failed to create attachment records:", attachError);
      // Don't throw - post was created successfully
    }
  }

  // Note: thread_access_tracking table has been deprecated
  // Access is now always granted, no tracking needed

  return postData as Post;
}

/**
 * Edit an existing post (only by owner)
 */
export async function editPost(
  postId: string,
  data: EditPostData,
): Promise<Post> {
  const userId = await getCurrentUserId();

  // First verify user owns the post
  const { data: existingPost, error: checkError } = await supabase
    .from("chat_posts")
    .select("user_id")
    .eq("id", postId)
    .single();

  if (checkError || !existingPost) {
    throw new Error("Post not found");
  }

  if (existingPost.user_id !== userId) {
    throw new Error("Unauthorized: You can only edit your own posts");
  }

  const updateData: Partial<Post> = {
    is_edited: true,
    edited_at: new Date().toISOString(),
  };

  if (data.title !== undefined) {
    if (data.title.length < 3 || data.title.length > 200) {
      throw new Error("Title must be between 3 and 200 characters");
    }
    updateData.title = data.title;
  }

  if (data.body !== undefined) {
    if (data.body.length < 10 || data.body.length > 5000) {
      throw new Error("Body must be between 10 and 5000 characters");
    }
    updateData.body = data.body;
  }

  if (data.tag !== undefined) {
    if (!["problem", "discussion", "other"].includes(data.tag)) {
      throw new Error("Invalid tag");
    }
    updateData.tag = data.tag;
  }

  const { data: postData, error: postError } = await supabase
    .from("chat_posts")
    .update(updateData)
    .eq("id", postId)
    .eq("user_id", userId) // Double-check ownership in update query
    .select()
    .single();

  if (postError || !postData) {
    throw new Error(
      `Failed to edit post: ${postError?.message || "Post not found or unauthorized"}`,
    );
  }

  return postData as Post;
}

/**
 * Create a response to a post
 */
export async function createResponse(
  data: CreateResponseData,
): Promise<Response> {
  const userId = await getCurrentUserId();

  // Validate body
  if (data.body.length < 10 || data.body.length > 5000) {
    throw new Error("Body must be between 10 and 5000 characters");
  }

  // Get the post to check if user authored it (for fruit name inheritance)
  const { data: postData } = await supabase
    .from("chat_posts")
    .select("user_id, anonymous_thread_id")
    .eq("id", data.postId)
    .single();

  if (!postData) {
    throw new Error("Post not found");
  }

  // Determine fruit name: inherit if same user, generate new if different
  let fruitName: string;
  if (postData.user_id === userId) {
    // Same user: inherit fruit name
    fruitName = postData.anonymous_thread_id;
  } else {
    // Different user: generate new fruit name
    const { data: fruitData, error: fruitError } = await supabase.rpc(
      "generate_fruit_name",
    );
    if (fruitError || !fruitData) {
      throw new Error(
        `Failed to generate fruit name: ${fruitError?.message || "Unknown error"}`,
      );
    }
    fruitName = fruitData as string;
  }

  // Get course_id from post for attachment upload
  const { data: courseData } = await supabase
    .from("chat_posts")
    .select("course_id")
    .eq("id", data.postId)
    .single();

  if (!courseData) {
    throw new Error("Post not found");
  }

  // Upload attachments if provided
  const attachmentRecords: Omit<
    Attachment,
    "id" | "created_at" | "signed_url"
  >[] = [];
  if (data.attachments && data.attachments.length > 0) {
    for (let i = 0; i < data.attachments.length; i++) {
      const file = data.attachments[i];
      const { path } = await uploadAttachment(
        file,
        courseData.course_id,
        undefined,
        undefined,
      );

      attachmentRecords.push({
        post_id: null,
        response_id: null, // Will be set after response creation
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        display_order: i,
      });
    }
  }

  // Create response
  const { data: responseData, error: responseError } = await supabase
    .from("chat_responses")
    .insert({
      post_id: data.postId,
      user_id: userId,
      anonymous_thread_id: fruitName,
      body: data.body,
    })
    .select()
    .single();

  if (responseError || !responseData) {
    throw new Error(
      `Failed to create response: ${responseError?.message || "Unknown error"}`,
    );
  }

  // Create attachment records
  if (attachmentRecords.length > 0) {
    const attachmentsToInsert = attachmentRecords.map((att) => ({
      ...att,
      response_id: responseData.id,
    }));

    const { error: attachError } = await supabase
      .from("chat_attachments")
      .insert(attachmentsToInsert);

    if (attachError) {
      console.error("Failed to create attachment records:", attachError);
    }
  }

  // Note: thread_access_tracking table has been deprecated
  // Access is now always granted, no tracking needed

  return responseData as Response;
}

/**
 * Vote on a post or response
 */
export async function vote(data: VoteData): Promise<{ netScore: number }> {
  const userId = await getCurrentUserId();

  // Check if user already voted
  const { data: existingVote } = await supabase
    .from("chat_votes")
    .select("id, vote_type")
    .eq("user_id", userId)
    .eq("target_id", data.targetId)
    .eq("target_type", data.targetType)
    .single();

  if (existingVote) {
    // User already voted - update or delete
    if (existingVote.vote_type === data.voteType) {
      // Same vote type - remove vote (toggle off)
      const { error: deleteError } = await supabase
        .from("chat_votes")
        .delete()
        .eq("id", existingVote.id);

      if (deleteError) {
        throw new Error(`Failed to remove vote: ${deleteError.message}`);
      }
    } else {
      // Different vote type - update
      const { error: updateError } = await supabase
        .from("chat_votes")
        .update({ vote_type: data.voteType })
        .eq("id", existingVote.id);

      if (updateError) {
        throw new Error(`Failed to update vote: ${updateError.message}`);
      }
    }
  } else {
    // New vote - insert
    const { error: insertError } = await supabase.from("chat_votes").insert({
      user_id: userId,
      target_id: data.targetId,
      target_type: data.targetType,
      vote_type: data.voteType,
    });

    if (insertError) {
      throw new Error(`Failed to create vote: ${insertError.message}`);
    }

    // If this is an upvote on a response, check if we should award credit
    // Note: Credits are now stored in users.forum_data JSONB
    if (data.targetType === "response" && data.voteType === "up") {
      // Get response to find author and post
      const { data: responseData } = await supabase
        .from("chat_responses")
        .select("post_id, user_id")
        .eq("id", data.targetId)
        .single();

      if (responseData && responseData.user_id) {
        const { data: postData } = await supabase
          .from("chat_posts")
          .select("course_id")
          .eq("id", responseData.post_id)
          .single();

        if (postData) {
          // Check if this is the first upvote
          const { count: upvoteCount } = await supabase
            .from("chat_votes")
            .select("id", { count: "exact", head: true })
            .eq("target_id", data.targetId)
            .eq("target_type", "response")
            .eq("vote_type", "up");

          // If this is the first upvote (count = 1), award credit to response author
          if (upvoteCount === 1) {
            const authorId = responseData.user_id;
            const courseId = String(postData.course_id);

            // Get author's forum_data
            const { data: authorData } = await supabase
              .from("users")
              .select("forum_data")
              .eq("id", authorId)
              .single();

            if (authorData) {
              const forumData = (authorData.forum_data || {}) as Record<
                string,
                unknown
              >;
              const courseStats = (
                (forumData.courseStats || {}) as Record<string, unknown>
              )[courseId] as
                | {
                    totalEarned?: number;
                    totalUsed?: number;
                    firstUnlockUsed?: boolean;
                  }
                | undefined;

              // Increment totalEarned for this course
              const newForumData = {
                ...forumData,
                courseStats: {
                  ...((forumData.courseStats as Record<string, unknown>) || {}),
                  [courseId]: {
                    ...(courseStats || {}),
                    totalEarned: (courseStats?.totalEarned || 0) + 1,
                  },
                },
              };

              await supabase
                .from("users")
                .update({ forum_data: newForumData })
                .eq("id", authorId);
            }
          }
        }
      }
    }
  }

  // Get updated net score
  const tableName =
    data.targetType === "post" ? "chat_posts" : "chat_responses";
  const { data: targetData } = await supabase
    .from(tableName)
    .select("net_score")
    .eq("id", data.targetId)
    .single();

  if (!targetData) {
    throw new Error("Failed to get updated score");
  }

  return { netScore: targetData.net_score };
}

/**
 * Check user's access status for a thread
 * NOTE: All posts and responses are now free to view - access is always granted
 */
export async function checkAccess(postId: string): Promise<AccessStatus> {
  // All posts and responses are free to view - always return access granted
  return {
    hasAccess: true,
    isContributor: false,
    canUnlock: false,
    unlockApplied: false,
    firstUnlockAvailable: false,
    availableCredits: 0,
  };
}

/**
 * Apply unlock credit to a thread
 * Note: With the new schema, unlock credits are stored in users.forum_data JSONB
 * Format: forum_data.courseStats[courseId] = { totalEarned, totalUsed, firstUnlockUsed }
 */
export async function applyUnlock(postId: string): Promise<boolean> {
  const userId = await getCurrentUserId();

  // Get post to find course_id
  const { data: postData } = await supabase
    .from("chat_posts")
    .select("course_id")
    .eq("id", postId)
    .single();

  if (!postData) {
    throw new Error("Post not found");
  }

  const courseId = String(postData.course_id);

  // Get user's forum_data
  const { data: userData, error: userError } = await supabase
    .from("users")
    .select("forum_data")
    .eq("id", userId)
    .single();

  if (userError || !userData) {
    console.error("Failed to get user data:", userError);
    return false;
  }

  const forumData = (userData.forum_data || {}) as Record<string, unknown>;
  const courseStats = (
    (forumData.courseStats || {}) as Record<string, unknown>
  )[courseId] as
    | {
        totalEarned?: number;
        totalUsed?: number;
        firstUnlockUsed?: boolean;
      }
    | undefined;

  // Apply first free unlock if available
  if (!courseStats || !courseStats.firstUnlockUsed) {
    // Update users.forum_data to mark first unlock as used
    const newForumData = {
      ...forumData,
      courseStats: {
        ...((forumData.courseStats as Record<string, unknown>) || {}),
        [courseId]: {
          ...(courseStats || {}),
          firstUnlockUsed: true,
        },
      },
    };

    const { error: updateError } = await supabase
      .from("users")
      .update({ forum_data: newForumData })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to update forum_data:", updateError);
      return false;
    }

    return true;
  }

  // Apply earned credit if available
  const totalEarned = courseStats.totalEarned || 0;
  const totalUsed = courseStats.totalUsed || 0;
  const availableCredits = totalEarned - totalUsed;

  if (availableCredits > 0) {
    // Update users.forum_data with incremented totalUsed
    const newForumData = {
      ...forumData,
      courseStats: {
        ...((forumData.courseStats as Record<string, unknown>) || {}),
        [courseId]: {
          ...courseStats,
          totalUsed: totalUsed + 1,
        },
      },
    };

    const { error: updateError } = await supabase
      .from("users")
      .update({ forum_data: newForumData })
      .eq("id", userId);

    if (updateError) {
      console.error("Failed to update forum_data:", updateError);
      return false;
    }

    return true;
  }

  return false; // No credits available
}

/**
 * Check if user has seen onboarding for a course
 * Note: With the new schema, onboarding state is stored in users.forum_data JSONB
 * Format: forum_data.courseStats[courseId].hasSeenOnboarding
 */
export async function getOnboardingState(
  courseId: number,
): Promise<UserOnboardingState | null> {
  const userId = await getCurrentUserId();
  const courseIdStr = String(courseId);

  const { data: userData, error } = await supabase
    .from("users")
    .select("forum_data")
    .eq("id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    // PGRST116 = not found
    throw new Error(`Failed to get onboarding state: ${error.message}`);
  }

  if (!userData) {
    return null;
  }

  const forumData = (userData.forum_data || {}) as Record<string, unknown>;
  const courseStats = (
    (forumData.courseStats || {}) as Record<string, unknown>
  )[courseIdStr] as
    | {
        hasSeenOnboarding?: boolean;
      }
    | undefined;

  if (!courseStats || !courseStats.hasSeenOnboarding) {
    return null;
  }

  // Return in the expected format for backward compatibility
  return {
    user_id: userId,
    course_id: courseId,
    has_seen_onboarding: true,
    seen_at: null,
  } as UserOnboardingState;
}

/**
 * Mark onboarding as seen for a course
 * Note: With the new schema, onboarding state is stored in users.forum_data JSONB
 */
export async function markOnboardingSeen(courseId: number): Promise<void> {
  const userId = await getCurrentUserId();
  const courseIdStr = String(courseId);

  // Get current forum_data
  const { data: userData, error: fetchError } = await supabase
    .from("users")
    .select("forum_data")
    .eq("id", userId)
    .single();

  if (fetchError) {
    throw new Error(`Failed to get user data: ${fetchError.message}`);
  }

  const forumData = (userData?.forum_data || {}) as Record<string, unknown>;
  const courseStats =
    ((forumData.courseStats || {}) as Record<string, unknown>)[courseIdStr] ||
    {};

  // Update forum_data with hasSeenOnboarding
  const newForumData = {
    ...forumData,
    courseStats: {
      ...((forumData.courseStats as Record<string, unknown>) || {}),
      [courseIdStr]: {
        ...(courseStats as Record<string, unknown>),
        hasSeenOnboarding: true,
      },
    },
  };

  const { error: updateError } = await supabase
    .from("users")
    .update({ forum_data: newForumData })
    .eq("id", userId);

  if (updateError) {
    throw new Error(
      `Failed to mark onboarding as seen: ${updateError.message}`,
    );
  }
}

/**
 * Delete a post (only by owner)
 */
export async function deletePost(postId: string): Promise<void> {
  const userId = await getCurrentUserId();

  // First verify user owns the post
  const { data: postData, error: checkError } = await supabase
    .from("chat_posts")
    .select("user_id")
    .eq("id", postId)
    .single();

  if (checkError || !postData) {
    throw new Error("Post not found");
  }

  if (postData.user_id !== userId) {
    throw new Error("Unauthorized: You can only delete your own posts");
  }

  // Delete the post (cascade will handle related records)
  const { error: deleteError } = await supabase
    .from("chat_posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", userId);

  if (deleteError) {
    throw new Error(`Failed to delete post: ${deleteError.message}`);
  }
}

/**
 * Edit a response (only by owner)
 */
export async function editResponse(
  responseId: string,
  data: EditResponseData,
): Promise<Response> {
  const userId = await getCurrentUserId();

  // Validate body
  if (data.body.length < 10 || data.body.length > 5000) {
    throw new Error("Body must be between 10 and 5000 characters");
  }

  // Get the response to check ownership and get post_id for attachments
  const { data: responseData } = await supabase
    .from("chat_responses")
    .select("user_id, post_id")
    .eq("id", responseId)
    .single();

  if (!responseData) {
    throw new Error("Response not found");
  }

  if (responseData.user_id !== userId) {
    throw new Error("Unauthorized: You can only edit your own responses");
  }

  // Get course_id from post for attachment upload
  const { data: postData } = await supabase
    .from("chat_posts")
    .select("course_id")
    .eq("id", responseData.post_id)
    .single();

  if (!postData) {
    throw new Error("Post not found");
  }

  // Handle attachments if provided
  // Note: For simplicity, we'll replace all attachments. In production, you might want to merge.
  if (data.attachments && data.attachments.length > 0) {
    // Delete existing attachments
    await supabase
      .from("chat_attachments")
      .delete()
      .eq("response_id", responseId);

    // Upload new attachments
    const attachmentRecords: Omit<
      Attachment,
      "id" | "created_at" | "signed_url"
    >[] = [];
    for (let i = 0; i < data.attachments.length; i++) {
      const file = data.attachments[i];
      const { path } = await uploadAttachment(
        file,
        postData.course_id,
        undefined,
        responseId,
      );

      attachmentRecords.push({
        post_id: null,
        response_id: responseId,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        display_order: i,
      });
    }

    // Insert new attachment records
    if (attachmentRecords.length > 0) {
      const { error: attachError } = await supabase
        .from("chat_attachments")
        .insert(attachmentRecords);

      if (attachError) {
        console.error("Failed to create attachment records:", attachError);
      }
    }
  }

  // Update response
  const { data: updatedResponse, error: updateError } = await supabase
    .from("chat_responses")
    .update({
      body: data.body,
      is_edited: true,
      edited_at: new Date().toISOString(),
    })
    .eq("id", responseId)
    .eq("user_id", userId)
    .select()
    .single();

  if (updateError || !updatedResponse) {
    throw new Error(
      `Failed to edit response: ${updateError?.message || "Unknown error"}`,
    );
  }

  return updatedResponse as Response;
}

/**
 * Delete a response (only by owner)
 */
export async function deleteResponse(responseId: string): Promise<void> {
  const userId = await getCurrentUserId();

  // First verify user owns the response
  const { data: responseData, error: checkError } = await supabase
    .from("chat_responses")
    .select("user_id")
    .eq("id", responseId)
    .single();

  if (checkError || !responseData) {
    throw new Error("Response not found");
  }

  if (responseData.user_id !== userId) {
    throw new Error("Unauthorized: You can only delete your own responses");
  }

  // Delete the response (cascade will handle related records)
  const { error: deleteError } = await supabase
    .from("chat_responses")
    .delete()
    .eq("id", responseId)
    .eq("user_id", userId);

  if (deleteError) {
    throw new Error(`Failed to delete response: ${deleteError.message}`);
  }
}
