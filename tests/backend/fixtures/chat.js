/**
 * Chat test fixtures
 * Static chat post, response, and vote data for testing
 */

const samplePost1 = {
  id: 'post-1',
  user_id: 'user-123',
  title: 'Help with Assignment 1',
  body: 'I\'m having trouble understanding how to implement the binary search algorithm. Can anyone explain the logic?',
  tag: 'CSCI 3308',
  course_id: '123456',
  upvotes: 5,
  downvotes: 0,
  is_locked: false,
  unlocked_at: null,
  created_at: '2026-01-07T10:30:00.000Z',
  updated_at: '2026-01-08T09:15:00.000Z',
};

const samplePost2 = {
  id: 'post-2',
  user_id: 'user-456',
  title: 'Study Group for Midterm',
  body: 'Anyone interested in forming a study group for the upcoming midterm? Let me know!',
  tag: 'CSCI 2400',
  course_id: '123457',
  upvotes: 12,
  downvotes: 1,
  is_locked: true,
  unlocked_at: '2026-01-08T15:00:00.000Z',
  created_at: '2026-01-06T14:20:00.000Z',
  updated_at: '2026-01-08T15:00:00.000Z',
};

const samplePost3 = {
  id: 'post-3',
  user_id: 'user-789',
  title: 'Calculus Resources',
  body: 'Here are some great YouTube channels that helped me understand derivatives better: [links]',
  tag: 'MATH 2400',
  course_id: '123458',
  upvotes: 8,
  downvotes: 0,
  is_locked: false,
  unlocked_at: null,
  created_at: '2026-01-05T16:45:00.000Z',
  updated_at: '2026-01-07T11:30:00.000Z',
};

const lockedPost = {
  id: 'post-4',
  user_id: 'user-111',
  title: 'Project Team Formation',
  body: 'Looking for teammates for the final project. Need frontend and backend developers.',
  tag: 'CSCI 3308',
  course_id: '123456',
  upvotes: 15,
  downvotes: 2,
  is_locked: true,
  unlocked_at: '2026-01-09T10:00:00.000Z',
  created_at: '2026-01-04T12:00:00.000Z',
  updated_at: '2026-01-09T10:00:00.000Z',
};

const highlyVotedPost = {
  id: 'post-5',
  user_id: 'user-222',
  title: 'Exam Tips and Tricks',
  body: 'Here\'s what I learned from taking this class last semester. Focus on these topics...',
  tag: 'CSCI 3308',
  course_id: '123456',
  upvotes: 25,
  downvotes: 3,
  is_locked: false,
  unlocked_at: null,
  created_at: '2026-01-03T09:00:00.000Z',
  updated_at: '2026-01-08T08:00:00.000Z',
};

// Responses
const response1 = {
  id: 'response-1',
  post_id: 'post-1',
  user_id: 'user-456',
  body: 'Binary search works by dividing the search space in half each time. Here\'s a simple explanation...',
  upvotes: 3,
  downvotes: 0,
  created_at: '2026-01-07T11:00:00.000Z',
  updated_at: '2026-01-07T11:00:00.000Z',
};

const response2 = {
  id: 'response-2',
  post_id: 'post-1',
  user_id: 'user-789',
  body: 'I also struggled with this. Check out the visualization on algorithm.com, it really helped me.',
  upvotes: 2,
  downvotes: 0,
  created_at: '2026-01-07T11:30:00.000Z',
  updated_at: '2026-01-07T11:30:00.000Z',
};

const response3 = {
  id: 'response-3',
  post_id: 'post-2',
  user_id: 'user-123',
  body: 'I\'m interested! When were you thinking of meeting?',
  upvotes: 1,
  downvotes: 0,
  created_at: '2026-01-06T15:00:00.000Z',
  updated_at: '2026-01-06T15:00:00.000Z',
};

const response4 = {
  id: 'response-4',
  post_id: 'post-2',
  user_id: 'user-111',
  body: 'Count me in too! How about Saturday afternoon?',
  upvotes: 1,
  downvotes: 0,
  created_at: '2026-01-06T16:00:00.000Z',
  updated_at: '2026-01-06T16:00:00.000Z',
};

const response5 = {
  id: 'response-5',
  post_id: 'post-5',
  user_id: 'user-123',
  body: 'This is super helpful! Thank you for sharing!',
  upvotes: 5,
  downvotes: 0,
  created_at: '2026-01-03T10:00:00.000Z',
  updated_at: '2026-01-03T10:00:00.000Z',
};

// Votes
const vote1 = {
  id: 'vote-1',
  user_id: 'user-123',
  post_id: 'post-1',
  response_id: null,
  vote_type: 'upvote',
  created_at: '2026-01-07T10:35:00.000Z',
};

const vote2 = {
  id: 'vote-2',
  user_id: 'user-456',
  post_id: 'post-2',
  response_id: null,
  vote_type: 'upvote',
  created_at: '2026-01-06T14:25:00.000Z',
};

const vote3 = {
  id: 'vote-3',
  user_id: 'user-789',
  post_id: null,
  response_id: 'response-1',
  vote_type: 'upvote',
  created_at: '2026-01-07T11:05:00.000Z',
};

const vote4 = {
  id: 'vote-4',
  user_id: 'user-111',
  post_id: 'post-5',
  response_id: null,
  vote_type: 'downvote',
  created_at: '2026-01-03T09:30:00.000Z',
};

// Arrays for bulk operations
const allPosts = [samplePost1, samplePost2, samplePost3, lockedPost, highlyVotedPost];
const allResponses = [response1, response2, response3, response4, response5];
const allVotes = [vote1, vote2, vote3, vote4];

// Posts by course
const csci3308Posts = [samplePost1, lockedPost, highlyVotedPost];
const csci2400Posts = [samplePost2];
const math2400Posts = [samplePost3];

// Posts by status
const activePosts = [samplePost1, samplePost3, highlyVotedPost];
const lockedPosts = [samplePost2, lockedPost];

// Chat statistics
const chatStats = {
  totalPosts: 5,
  totalResponses: 5,
  totalVotes: 4,
  activePosts: 3,
  lockedPosts: 2,
  avgResponsesPerPost: 1,
  mostPopularTag: 'CSCI 3308',
};

module.exports = {
  samplePost1,
  samplePost2,
  samplePost3,
  lockedPost,
  highlyVotedPost,
  response1,
  response2,
  response3,
  response4,
  response5,
  vote1,
  vote2,
  vote3,
  vote4,
  allPosts,
  allResponses,
  allVotes,
  csci3308Posts,
  csci2400Posts,
  math2400Posts,
  activePosts,
  lockedPosts,
  chatStats,

  // Helper to get post by ID
  getPostById: (postId) => allPosts.find(p => p.id === postId),

  // Helper to get responses for a post
  getResponsesByPostId: (postId) => allResponses.filter(r => r.post_id === postId),

  // Helper to get votes for a post
  getVotesByPostId: (postId) => allVotes.filter(v => v.post_id === postId),

  // Helper to get posts by tag
  getPostsByTag: (tag) => allPosts.filter(p => p.tag === tag),

  // Helper to get posts by course
  getPostsByCourse: (courseId) => allPosts.filter(p => p.course_id === courseId),

  // Helper to check if post is locked
  isPostLocked: (postId) => {
    const post = allPosts.find(p => p.id === postId);
    if (!post) return false;
    if (!post.is_locked) return false;
    if (!post.unlocked_at) return true;
    return new Date(post.unlocked_at) > new Date();
  },
};
