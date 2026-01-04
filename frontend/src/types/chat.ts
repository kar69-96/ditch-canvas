/**
 * Type definitions for the Anonymous Class Discussion Forum
 */

export type PostTag = 'problem' | 'discussion' | 'other';
export type VoteType = 'up' | 'down';
export type VoteTargetType = 'post' | 'response';
export type SortMode = 'default' | 'newest' | 'responses' | 'score';

export interface Post {
  id: string;
  course_id: number;
  user_id: string;
  anonymous_thread_id: string; // Fruit name
  title: string;
  body: string;
  tag: PostTag;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_edited: boolean;
  response_count: number;
  net_score: number;
  user_vote?: 'up' | 'down' | null; // Current user's vote on this post
}

export interface Response {
  id: string;
  post_id: string;
  user_id: string;
  anonymous_thread_id: string; // Fruit name
  body: string;
  created_at: string;
  updated_at: string;
  is_edited: boolean;
  net_score: number;
}

export interface Vote {
  id: string;
  user_id: string;
  target_id: string;
  target_type: VoteTargetType;
  vote_type: VoteType;
  created_at: string;
}

export interface Attachment {
  id: string;
  post_id: string | null;
  response_id: string | null;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  display_order: number;
  created_at: string;
  signed_url?: string; // Populated when fetching
}

export interface PostWithResponses extends Post {
  responses: Response[];
  attachments: Attachment[];
  user_vote?: VoteType | null; // Current user's vote on this post
}

export interface ResponseWithDetails extends Response {
  attachments: Attachment[];
  user_vote?: VoteType | null; // Current user's vote on this response
}

export interface AccessStatus {
  hasAccess: boolean;
  isContributor: boolean;
  canUnlock: boolean;
  unlockApplied: boolean;
  firstUnlockAvailable: boolean;
  availableCredits: number;
}

export interface Filters {
  tag?: PostTag[];
  search?: string;
}

export interface UserUnlockCredits {
  id: string;
  user_id: string;
  course_id: number;
  total_earned: number;
  total_used: number;
  first_unlock_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface ThreadAccessTracking {
  id: string;
  user_id: string;
  post_id: string;
  has_contributed: boolean;
  unlock_applied: boolean;
  unlocked_at: string | null;
  created_at: string;
}

export interface UserOnboardingState {
  id: string;
  user_id: string;
  course_id: number;
  has_seen_onboarding: boolean;
  seen_at: string | null;
}

export interface CreatePostData {
  courseId: number;
  title: string;
  body: string;
  tag: PostTag;
  attachments?: File[];
}

export interface EditPostData {
  title?: string;
  body?: string;
  tag?: PostTag;
}

export interface CreateResponseData {
  postId: string;
  body: string;
  attachments?: File[];
}

export interface EditResponseData {
  body: string;
  attachments?: File[];
}

export interface VoteData {
  targetId: string;
  targetType: VoteTargetType;
  voteType: VoteType;
}

