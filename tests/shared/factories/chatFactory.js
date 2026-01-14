/**
 * Chat factory for generating test chat post, response, and vote data
 * Uses @faker-js/faker for realistic random data
 */

const { faker } = require('@faker-js/faker');

// Chat post topics by course type
const postTopics = {
  CSCI: [
    'Help with Assignment',
    'Study Group Formation',
    'Project Team Needed',
    'Debugging Tips',
    'Exam Preparation',
    'Code Review Request',
    'Resource Recommendations',
    'Career Advice',
  ],
  MATH: [
    'Problem Solving Help',
    'Tutoring Sessions',
    'Study Group',
    'Exam Tips',
    'Textbook Questions',
    'Practice Problems',
  ],
  general: [
    'General Question',
    'Course Discussion',
    'Study Tips',
    'Office Hours',
    'Extra Credit Opportunities',
  ],
};

const postBodies = {
  helpRequest: [
    'I\'m having trouble understanding {}. Can anyone explain the logic?',
    'Need help with {}. Any suggestions?',
    'Stuck on {}. Has anyone figured this out?',
    'Can someone clarify {} for me?',
  ],
  studyGroup: [
    'Anyone interested in forming a study group for {}?',
    'Looking to join a study group for {}. Let me know!',
    'Study group forming for {}. Who\'s in?',
  ],
  teamFormation: [
    'Looking for teammates for {}. Need {} developers.',
    'Team formation for {}. Who wants to join?',
    'Building a team for {}. Skills needed: {}.',
  ],
  resource: [
    'Here are some great resources for {}: [links]',
    'Found this helpful for {}: [resource]',
    'Check out these materials for {}: [links]',
  ],
};

/**
 * Create a single chat post
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat post object
 */
function createChatPost(overrides = {}) {
  const postId = overrides.id || faker.string.uuid();
  const userId = overrides.user_id || faker.string.uuid();
  const courseId = overrides.course_id || faker.string.numeric(6);
  const tag = overrides.tag || `CSCI ${faker.number.int({ min: 1000, max: 4999 })}`;

  const topicType = faker.helpers.arrayElement(['helpRequest', 'studyGroup', 'teamFormation', 'resource', 'general']);
  const topic = faker.helpers.arrayElement(postTopics.CSCI);

  let body;
  if (postBodies[topicType]) {
    const template = faker.helpers.arrayElement(postBodies[topicType]);
    body = template.replace('{}', faker.helpers.arrayElement(['the assignment', 'the project', 'the concept', 'this problem']));
  } else {
    body = faker.lorem.paragraph();
  }

  const createdAt = faker.date.recent({ days: 7 });
  const upvotes = faker.number.int({ min: 0, max: 25 });
  const downvotes = faker.number.int({ min: 0, max: Math.floor(upvotes / 4) });

  // Determine if post should be locked (requires upvotes)
  const minUpvotesToUnlock = 3;
  const isLocked = upvotes >= minUpvotesToUnlock;
  const unlockedAt = isLocked ? new Date(createdAt.getTime() + (upvotes * 1000 * 60 * 10)).toISOString() : null;

  return {
    id: postId,
    user_id: userId,
    title: topic,
    body,
    tag,
    course_id: courseId,
    upvotes,
    downvotes,
    is_locked: isLocked,
    unlocked_at: unlockedAt,
    created_at: createdAt.toISOString(),
    updated_at: faker.date.between({ from: createdAt, to: new Date() }).toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple chat posts
 * @param {number} count - Number of posts to create
 * @param {Object} overrides - Properties to override for all posts
 * @returns {Array} Array of chat post objects
 */
function createChatPosts(count, overrides = {}) {
  return Array.from({ length: count }, () => createChatPost(overrides));
}

/**
 * Create a locked chat post (high upvotes)
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat post object
 */
function createLockedChatPost(overrides = {}) {
  const upvotes = faker.number.int({ min: 10, max: 30 });
  const createdAt = faker.date.recent({ days: 3 });
  const unlockedAt = new Date(createdAt.getTime() + (upvotes * 1000 * 60 * 10)).toISOString();

  return createChatPost({
    upvotes,
    is_locked: true,
    unlocked_at: unlockedAt,
    created_at: createdAt.toISOString(),
    ...overrides,
  });
}

/**
 * Create a chat post with responses
 * @param {number} responseCount - Number of responses to create
 * @param {Object} overrides - Properties to override
 * @returns {Object} Object with post and responses
 */
function createChatPostWithResponses(responseCount = 3, overrides = {}) {
  const post = createChatPost(overrides);
  const responses = Array.from({ length: responseCount }, () =>
    createChatResponse({ post_id: post.id })
  );

  return { post, responses };
}

/**
 * Create a chat response
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat response object
 */
function createChatResponse(overrides = {}) {
  const responseId = overrides.id || faker.string.uuid();
  const postId = overrides.post_id || faker.string.uuid();
  const userId = overrides.user_id || faker.string.uuid();

  const responseTemplates = [
    'Here\'s what I found: {}',
    'I also struggled with this. {}',
    'Check out {}. It helped me.',
    'Have you tried {}?',
    'I\'m interested! {}',
    'That\'s a great idea! {}',
    'Thanks for sharing! {}',
  ];

  const template = faker.helpers.arrayElement(responseTemplates);
  const body = template.replace('{}', faker.lorem.sentence());

  const createdAt = faker.date.recent({ days: 5 });

  return {
    id: responseId,
    post_id: postId,
    user_id: userId,
    body,
    upvotes: faker.number.int({ min: 0, max: 10 }),
    downvotes: faker.number.int({ min: 0, max: 3 }),
    created_at: createdAt.toISOString(),
    updated_at: createdAt.toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple chat responses for a post
 * @param {string} postId - Post ID
 * @param {number} count - Number of responses
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of chat response objects
 */
function createChatResponses(postId, count = 3, overrides = {}) {
  return Array.from({ length: count }, () =>
    createChatResponse({ post_id: postId, ...overrides })
  );
}

/**
 * Create a chat vote
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat vote object
 */
function createChatVote(overrides = {}) {
  const voteId = overrides.id || faker.string.uuid();
  const userId = overrides.user_id || faker.string.uuid();
  const voteType = overrides.vote_type || faker.helpers.arrayElement(['upvote', 'downvote']);

  // Either post_id or response_id should be set, not both
  const isPostVote = !overrides.response_id && faker.datatype.boolean();
  const postId = isPostVote ? (overrides.post_id || faker.string.uuid()) : null;
  const responseId = !isPostVote ? (overrides.response_id || faker.string.uuid()) : null;

  return {
    id: voteId,
    user_id: userId,
    post_id: postId,
    response_id: responseId,
    vote_type: voteType,
    created_at: faker.date.recent({ days: 7 }).toISOString(),
    ...overrides,
  };
}

/**
 * Create multiple chat votes
 * @param {number} count - Number of votes to create
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of chat vote objects
 */
function createChatVotes(count, overrides = {}) {
  return Array.from({ length: count }, () => createChatVote(overrides));
}

/**
 * Create upvote for a post
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat vote object
 */
function createUpvoteForPost(postId, userId, overrides = {}) {
  return createChatVote({
    post_id: postId,
    response_id: null,
    user_id: userId,
    vote_type: 'upvote',
    ...overrides,
  });
}

/**
 * Create upvote for a response
 * @param {string} responseId - Response ID
 * @param {string} userId - User ID
 * @param {Object} overrides - Properties to override
 * @returns {Object} Chat vote object
 */
function createUpvoteForResponse(responseId, userId, overrides = {}) {
  return createChatVote({
    post_id: null,
    response_id: responseId,
    user_id: userId,
    vote_type: 'upvote',
    ...overrides,
  });
}

/**
 * Create a complete chat thread (post + responses + votes)
 * @param {Object} options - Configuration options
 * @returns {Object} Object with post, responses, and votes
 */
function createChatThread(options = {}) {
  const {
    responseCount = faker.number.int({ min: 1, max: 5 }),
    voteCount = faker.number.int({ min: 5, max: 15 }),
    ...postOverrides
  } = options;

  const post = createChatPost(postOverrides);
  const responses = createChatResponses(post.id, responseCount);
  const votes = createChatVotes(voteCount, { post_id: post.id, response_id: null });

  // Add some votes to responses
  responses.forEach(response => {
    const responseVoteCount = faker.number.int({ min: 0, max: 3 });
    for (let i = 0; i < responseVoteCount; i++) {
      votes.push(createChatVote({ post_id: null, response_id: response.id }));
    }
  });

  return { post, responses, votes };
}

/**
 * Create posts for a specific course
 * @param {string} courseId - Course ID
 * @param {string} tag - Course tag (e.g., "CSCI 3308")
 * @param {number} count - Number of posts
 * @param {Object} overrides - Properties to override
 * @returns {Array} Array of chat post objects
 */
function createChatPostsForCourse(courseId, tag, count = 5, overrides = {}) {
  return Array.from({ length: count }, () =>
    createChatPost({ course_id: courseId, tag, ...overrides })
  );
}

module.exports = {
  createChatPost,
  createChatPosts,
  createLockedChatPost,
  createChatPostWithResponses,
  createChatResponse,
  createChatResponses,
  createChatVote,
  createChatVotes,
  createUpvoteForPost,
  createUpvoteForResponse,
  createChatThread,
  createChatPostsForCourse,
  postTopics,
};
