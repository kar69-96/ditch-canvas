-- ============================================
-- Update Seed: Use Actual Course IDs
-- ============================================
-- This migration deletes existing seed posts and re-seeds with actual course IDs
-- from your database. It automatically finds your courses.
-- ============================================

-- First, delete existing seed posts (optional - comment out if you want to keep them)
-- DELETE FROM chat_posts WHERE title IN (
--   'Question about Assignment 3',
--   'Study Group for Midterm',
--   'Office Hours Question',
--   'Project Ideas Discussion',
--   'Error in Lab Exercise 5'
-- );

-- Now re-seed with actual courses
DO $$
DECLARE
  sample_user_id TEXT;
  sample_user_email TEXT;
  sample_course_ids INTEGER[] := ARRAY[]::INTEGER[];
  post_record RECORD;
  fruit_names TEXT[] := ARRAY['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry', 'Strawberry', 'Tangerine', 'Ugli', 'Watermelon'];
  selected_fruit TEXT;
  response_fruit TEXT;
  course_idx INTEGER;
  course_entity RECORD;
BEGIN
  -- Get the first user from the users table
  SELECT id, email INTO sample_user_id, sample_user_email FROM users LIMIT 1;
  
  IF sample_user_id IS NULL THEN
    RAISE EXCEPTION 'No users found in database. Please create a user first.';
  END IF;

  -- Try to get course IDs from the flexible storage system (get_user_entities)
  BEGIN
    FOR course_entity IN 
      SELECT DISTINCT 
        CASE 
          WHEN entity_id ~ '^[0-9]+$' THEN entity_id::INTEGER
          ELSE NULL
        END AS course_id
      FROM (
        SELECT entity_id
        FROM get_user_entities(sample_user_email, 'course', NULL)
        LIMIT 20
      ) AS courses
      WHERE entity_id ~ '^[0-9]+$'
    LOOP
      IF course_entity.course_id IS NOT NULL THEN
        sample_course_ids := array_append(sample_course_ids, course_entity.course_id);
      END IF;
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'Could not fetch courses from flexible storage: %', SQLERRM;
  END;

  -- If no courses found from flexible storage, try to get from existing chat_posts
  IF array_length(sample_course_ids, 1) IS NULL THEN
    SELECT ARRAY_AGG(DISTINCT course_id) INTO sample_course_ids
    FROM chat_posts
    WHERE course_id IS NOT NULL
    LIMIT 10;
  END IF;

  -- If still no courses found, raise an error with helpful message
  IF array_length(sample_course_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No courses found. Please ensure you have courses in your database.';
  END IF;

  RAISE NOTICE 'Using user_id: % (email: %)', sample_user_id, sample_user_email;
  RAISE NOTICE 'Found % course(s): %', array_length(sample_course_ids, 1), sample_course_ids;

  -- Insert sample posts for each course
  FOR course_idx IN 1..array_length(sample_course_ids, 1) LOOP
    DECLARE
      course_id_val INTEGER := sample_course_ids[course_idx];
    BEGIN
      RAISE NOTICE 'Inserting 5 posts for course_id: %', course_id_val;
      
      -- Post 1: Problem/Question
      selected_fruit := fruit_names[1 + ((1 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        'Question about Assignment 3',
        'I''m having trouble understanding the requirements for Assignment 3. Specifically, I''m confused about the data structure we need to implement. Can anyone clarify what the expected output format should be?',
        'problem',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      ) RETURNING * INTO post_record;
      
      -- Add responses to post 1
      response_fruit := fruit_names[1 + ((2 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'Great question! I had the same issue. The key is to use a hash map for O(1) lookups. Here''s what worked for me...',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      );
      
      -- Update response count
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      
      -- Create thread access tracking
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 2: Discussion
      selected_fruit := fruit_names[1 + ((3 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        'Study Group for Midterm',
        'Anyone interested in forming a study group for the upcoming midterm? We could meet a few times before the exam to review key concepts and work through practice problems together. Let me know if you''re interested!',
        'discussion',
        NOW() - INTERVAL '5 days',
        NOW() - INTERVAL '5 days'
      ) RETURNING * INTO post_record;
      
      -- Add 2 responses to post 2
      response_fruit := fruit_names[1 + ((4 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'I''d be interested in joining! When were you thinking of meeting?',
        NOW() - INTERVAL '4 days',
        NOW() - INTERVAL '4 days'
      );
      
      response_fruit := fruit_names[1 + ((5 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'Count me in! I think meeting twice a week would be helpful.',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '3 days'
      );
      
      -- Update response count
      UPDATE chat_posts SET response_count = 2 WHERE id = post_record.id;
      
      -- Create thread access tracking
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 3: Other/General
      selected_fruit := fruit_names[1 + ((6 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        'Office Hours Question',
        'I noticed the professor mentioned office hours in the last lecture, but I couldn''t catch the exact time. Does anyone know when they are? Also, are they in person or virtual?',
        'other',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      ) RETURNING * INTO post_record;
      
      -- Add 1 response to post 3
      response_fruit := fruit_names[1 + ((7 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'Office hours are Tuesdays and Thursdays from 2-4 PM in the CS building, room 123. They''re in person this semester.',
        NOW() - INTERVAL '12 hours',
        NOW() - INTERVAL '12 hours'
      );
      
      -- Update response count
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      
      -- Create thread access tracking
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 4: Discussion
      selected_fruit := fruit_names[1 + ((8 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        'Project Ideas Discussion',
        'For the final project, I''m thinking about exploring machine learning applications in healthcare. Would love to hear what others are planning and maybe collaborate if there''s overlap! What are your thoughts?',
        'discussion',
        NOW() - INTERVAL '7 days',
        NOW() - INTERVAL '7 days'
      ) RETURNING * INTO post_record;
      
      -- Add 1 response
      response_fruit := fruit_names[1 + ((9 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'That sounds like an interesting project idea! I''m working on something similar. Maybe we could discuss collaboration?',
        NOW() - INTERVAL '6 days',
        NOW() - INTERVAL '6 days'
      );
      
      -- Update response count
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      
      -- Create thread access tracking
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 5: Problem
      selected_fruit := fruit_names[1 + ((10 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        'Error in Lab Exercise 5',
        'I keep getting a segmentation fault when running the code from Lab Exercise 5. Has anyone else encountered this issue? I''ve checked my memory allocation but can''t find the problem. Any suggestions?',
        'problem',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '3 days'
      ) RETURNING * INTO post_record;
      
      -- Add 2 responses
      response_fruit := fruit_names[1 + ((11 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'I think the issue might be related to how you''re handling the edge cases. Try checking your boundary conditions.',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      );
      
      response_fruit := fruit_names[1 + ((12 + (course_idx * 2)) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        'This is a common mistake. Make sure you''re initializing all your variables before use, especially pointers.',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      );
      
      -- Update response count
      UPDATE chat_posts SET response_count = 2 WHERE id = post_record.id;
      
      -- Create thread access tracking
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;
    END;
  END LOOP;

  RAISE NOTICE 'Sample chat posts seeded successfully for % course(s)!', array_length(sample_course_ids, 1);
END $$;

