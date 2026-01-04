/**
 * Script to seed sample chat posts and responses for all courses
 * Run with: node scripts/utils/seed-chat-data.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Sample post data
const samplePosts = [
  {
    title: 'Question about Assignment 3',
    body: 'I\'m having trouble understanding the requirements for Assignment 3. Specifically, I\'m confused about the data structure we need to implement. Can anyone clarify?',
    tag: 'problem',
  },
  {
    title: 'Study Group for Midterm',
    body: 'Anyone interested in forming a study group for the upcoming midterm? We could meet a few times before the exam to review key concepts and work through practice problems together.',
    tag: 'discussion',
  },
  {
    title: 'Office Hours Question',
    body: 'I noticed the professor mentioned office hours in the last lecture, but I couldn\'t catch the exact time. Does anyone know when they are?',
    tag: 'other',
  },
  {
    title: 'Project Ideas Discussion',
    body: 'For the final project, I\'m thinking about exploring machine learning applications in healthcare. Would love to hear what others are planning and maybe collaborate if there\'s overlap!',
    tag: 'discussion',
  },
  {
    title: 'Error in Lab Exercise 5',
    body: 'I keep getting a segmentation fault when running the code from Lab Exercise 5. Has anyone else encountered this issue? I\'ve checked my memory allocation but can\'t find the problem.',
    tag: 'problem',
  },
];

// Sample responses
const sampleResponses = [
  'Great question! I had the same issue. The key is to use a hash map for O(1) lookups.',
  'Thanks for asking! I was wondering about this too.',
  'I found this resource helpful: [link]. It explains the concept really well.',
  'I think the issue might be related to how you\'re handling the edge cases. Try checking your boundary conditions.',
  'This is a common mistake. Make sure you\'re initializing all your variables before use.',
  'I\'d be interested in joining a study group! When were you thinking of meeting?',
  'Office hours are Tuesdays and Thursdays from 2-4 PM in the CS building.',
  'That sounds like an interesting project idea! I\'m working on something similar.',
];

// Fruit names for anonymity
const fruitNames = [
  'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew',
  'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry',
  'Strawberry', 'Tangerine', 'Ugli', 'Watermelon', 'Apricot', 'Blackberry', 'Cantaloupe',
  'Dragonfruit', 'Grapefruit', 'Lime', 'Lychee', 'Passionfruit', 'Pineapple', 'Plum',
];

/**
 * Get all courses from the database
 */
async function getAllCourses() {
  // Try to get courses from the flexible storage system
  // Query for all course entities
  const { data: courseEntities, error } = await supabase
    .rpc('get_user_entities', {
      user_email: null, // Get all courses
      entity_type_filter: 'course',
      course_id_filter: null,
    });
  
  if (!error && courseEntities && courseEntities.length > 0) {
    const uniqueCourseIds = [...new Set(courseEntities.map(e => parseInt(e.entity_id) || 0).filter(id => id > 0))];
    return uniqueCourseIds.map(id => ({ id }));
  }
  
  // Fallback: query Supabase for courses from chat_posts
  const { data: existingPosts } = await supabase
    .from('chat_posts')
    .select('course_id')
    .limit(100);
  
  if (existingPosts && existingPosts.length > 0) {
    const uniqueCourseIds = [...new Set(existingPosts.map(p => p.course_id))];
    return uniqueCourseIds.map(id => ({ id }));
  }
  
  // Last resort: try to get courses from extraction data
  const dataPath = path.join(__dirname, '../../frontend/mock-data/extraction-data');
  if (fs.existsSync(dataPath)) {
    const folders = fs.readdirSync(dataPath, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    if (folders.length > 0) {
      const firstFolder = folders[0];
      const courseFile = path.join(dataPath, firstFolder, 'courses.json');
      if (fs.existsSync(courseFile)) {
        const courseData = JSON.parse(fs.readFileSync(courseFile, 'utf-8'));
        if (Array.isArray(courseData) && courseData.length > 0) {
          return courseData.map(c => ({ id: c.id || c.courseId })).filter(c => c.id);
        }
      }
    }
  }
  
  // If no courses found, return empty array
  console.warn('No courses found. Please ensure courses exist in the database or data files.');
  return [];
}

/**
 * Get a random user ID from the database
 */
async function getRandomUserId() {
  const { data: users, error } = await supabase
    .from('users')
    .select('id')
    .limit(100);
  
  if (error || !users || users.length === 0) {
    throw new Error('No users found in database. Please create a user first.');
  }
  
  return users[Math.floor(Math.random() * users.length)].id;
}

/**
 * Generate a random fruit name
 */
function getRandomFruitName() {
  return fruitNames[Math.floor(Math.random() * fruitNames.length)];
}

/**
 * Seed posts and responses for a course
 */
async function seedCourse(courseId, userId) {
  console.log(`\nSeeding course ${courseId}...`);
  
  const postsToCreate = [];
  const numPosts = Math.floor(Math.random() * 3) + 3; // 3-5 posts
  
  for (let i = 0; i < numPosts; i++) {
    const postTemplate = samplePosts[i % samplePosts.length];
    const fruitName = getRandomFruitName();
    
    // Create post
    const { data: post, error: postError } = await supabase
      .from('chat_posts')
      .insert({
        course_id: courseId,
        user_id: userId,
        anonymous_thread_id: fruitName,
        title: postTemplate.title,
        body: postTemplate.body,
        tag: postTemplate.tag,
      })
      .select()
      .single();
    
    if (postError) {
      console.error(`Error creating post: ${postError.message}`);
      continue;
    }
    
    console.log(`  ✓ Created post: "${post.title}"`);
    postsToCreate.push(post);
    
    // Create 1-3 responses for each post
    const numResponses = Math.floor(Math.random() * 3) + 1;
    for (let j = 0; j < numResponses; j++) {
      const responseText = sampleResponses[j % sampleResponses.length];
      const responseFruitName = getRandomFruitName();
      
      const { data: response, error: responseError } = await supabase
        .from('chat_responses')
        .insert({
          post_id: post.id,
          user_id: userId,
          anonymous_thread_id: responseFruitName,
          body: responseText,
        })
        .select()
        .single();
      
      if (responseError) {
        console.error(`Error creating response: ${responseError.message}`);
        continue;
      }
      
      console.log(`    ✓ Created response`);
      
      // Create thread access tracking for the post creator
      await supabase
        .from('thread_access_tracking')
        .upsert({
          user_id: userId,
          post_id: post.id,
          has_contributed: true,
        }, {
          onConflict: 'user_id,post_id',
        });
    }
  }
  
  return postsToCreate.length;
}

/**
 * Main function
 */
async function main() {
  console.log('Starting chat data seeding...\n');
  
  try {
    // Get a user ID
    const userId = await getRandomUserId();
    console.log(`Using user ID: ${userId}`);
    
    // Get all courses
    const courses = await getAllCourses();
    
    if (courses.length === 0) {
      console.error('No courses found. Cannot seed data.');
      process.exit(1);
    }
    
    console.log(`Found ${courses.length} course(s)\n`);
    
    // Seed each course
    let totalPosts = 0;
    for (const course of courses) {
      const postsCreated = await seedCourse(course.id, userId);
      totalPosts += postsCreated;
    }
    
    console.log(`\n✓ Seeding complete!`);
    console.log(`  Total posts created: ${totalPosts}`);
    console.log(`  Courses seeded: ${courses.length}`);
    
  } catch (error) {
    console.error('Error seeding data:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };

