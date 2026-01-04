-- ============================================
-- Unique Posts Per Course
-- ============================================
-- This migration deletes existing seed posts and creates unique posts
-- with different content for each course.
-- ============================================

-- Delete existing seed posts and their responses (cascade should handle this, but being explicit)
DELETE FROM chat_responses WHERE post_id IN (
  SELECT id FROM chat_posts WHERE title IN (
    'Question about Assignment 3',
    'Study Group for Midterm',
    'Office Hours Question',
    'Project Ideas Discussion',
    'Error in Lab Exercise 5'
  )
);
DELETE FROM chat_posts WHERE title IN (
  'Question about Assignment 3',
  'Study Group for Midterm',
  'Office Hours Question',
  'Project Ideas Discussion',
  'Error in Lab Exercise 5'
);

-- Now create unique posts for each course
DO $$
DECLARE
  sample_user_id TEXT;
  sample_user_email TEXT;
  sample_course_ids INTEGER[] := ARRAY[]::INTEGER[];
  post_record RECORD;
  fruit_names TEXT[] := ARRAY['Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew', 'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry', 'Strawberry', 'Tangerine', 'Ugli', 'Watermelon', 'Apricot', 'Blackberry', 'Cantaloupe', 'Dragonfruit'];
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

  -- Try to get course IDs from the flexible storage system
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

  IF array_length(sample_course_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No courses found. Please ensure you have courses in your database.';
  END IF;

  RAISE NOTICE 'Using user_id: % (email: %)', sample_user_id, sample_user_email;
  RAISE NOTICE 'Found % course(s): %', array_length(sample_course_ids, 1), sample_course_ids;

  -- Insert unique posts for each course
  FOR course_idx IN 1..array_length(sample_course_ids, 1) LOOP
    DECLARE
      course_id_val INTEGER := sample_course_ids[course_idx];
    BEGIN
      RAISE NOTICE 'Inserting unique posts for course_id: %', course_id_val;
      
      -- Post 1: Course-specific problem/question
      selected_fruit := fruit_names[1 + ((course_idx * 3) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        CASE course_idx
          WHEN 1 THEN 'Confused about Week 3 Lecture Material'
          WHEN 2 THEN 'Need Help with Lab Assignment 2'
          WHEN 3 THEN 'Question about Project Requirements'
          WHEN 4 THEN 'Understanding the Midterm Format'
          WHEN 5 THEN 'Stuck on Homework Problem 5'
          WHEN 6 THEN 'Clarification Needed on Assignment Guidelines'
          ELSE 'Question about Course Material'
        END,
        CASE course_idx
          WHEN 1 THEN 'I''m having trouble understanding the concepts covered in Week 3. Specifically, the lecture on data structures was confusing. Can someone explain the key points or share their notes?'
          WHEN 2 THEN 'I''ve been working on Lab Assignment 2 for hours but can''t get past the first part. The instructions seem unclear. Has anyone completed it and can share some insights?'
          WHEN 3 THEN 'The project requirements mention several deliverables but I''m not sure about the expected format. Should we submit a written report or just code? Any guidance would be appreciated.'
          WHEN 4 THEN 'Does anyone know what format the midterm will be? Will it be multiple choice, short answer, or coding problems? I want to prepare accordingly.'
          WHEN 5 THEN 'I''ve been stuck on Homework Problem 5 for two days. I understand the concept but can''t seem to implement it correctly. Any hints or suggestions?'
          WHEN 6 THEN 'The assignment guidelines mention using a specific library, but I can''t find it in the course materials. Am I missing something or should I install it separately?'
          ELSE 'I have a question about the course material and would appreciate any help or clarification.'
        END,
        'problem',
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      ) RETURNING * INTO post_record;
      
      -- Add response to post 1
      response_fruit := fruit_names[1 + ((course_idx * 3 + 1) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'I found the Week 3 material challenging too. The key is understanding how the data structures relate to each other. I can share my notes if that helps!'
          WHEN 2 THEN 'Lab 2 is tricky! The main issue is usually in the initialization step. Make sure you''re setting up your variables correctly before the loop.'
          WHEN 3 THEN 'Based on the rubric, I think they want both - a brief written explanation and the code. I''d recommend checking the example projects from previous semesters.'
          WHEN 4 THEN 'From what I heard, it''s a mix of multiple choice and short coding problems. Focus on the practice problems from the textbook.'
          WHEN 5 THEN 'For Problem 5, try breaking it down into smaller sub-problems. The trick is in how you handle the edge cases.'
          WHEN 6 THEN 'That library should be in the course resources folder. If you can''t find it, try asking the TA during office hours.'
          ELSE 'That''s a great question! I''d suggest checking the course materials or reaching out to the professor.'
        END,
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      );
      
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 2: Course-specific discussion
      selected_fruit := fruit_names[1 + ((course_idx * 3 + 2) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        CASE course_idx
          WHEN 1 THEN 'Study Group for Next Exam'
          WHEN 2 THEN 'Collaborative Project Ideas'
          WHEN 3 THEN 'Discussion: Best Study Resources'
          WHEN 4 THEN 'Forming a Study Group'
          WHEN 5 THEN 'Sharing Study Tips and Tricks'
          WHEN 6 THEN 'Group Study Session Planning'
          ELSE 'General Course Discussion'
        END,
        CASE course_idx
          WHEN 1 THEN 'Anyone interested in forming a study group for the upcoming exam? We could meet a couple times before the test to review key concepts, work through practice problems, and quiz each other. Let me know if you''re interested!'
          WHEN 2 THEN 'I''m looking for project partners for the final assignment. I''m particularly interested in working on something related to machine learning applications. Anyone want to collaborate or discuss ideas?'
          WHEN 3 THEN 'What study resources have you all found most helpful? I''ve been using the textbook and lecture slides, but wondering if there are other materials like video tutorials or practice sites that others recommend.'
          WHEN 4 THEN 'I think studying in a group would be really helpful for this course. We could meet weekly to go over the material, help each other with homework, and prepare for exams together. Who''s interested?'
          WHEN 5 THEN 'I''ve found some really effective study techniques for this course and wanted to share. Also curious what strategies others have found helpful. Let''s discuss!'
          WHEN 6 THEN 'Planning a group study session for the upcoming quiz. We could meet at the library or online. What time works best for everyone?'
          ELSE 'Let''s discuss the course material and help each other out!'
        END,
        'discussion',
        NOW() - INTERVAL '5 days',
        NOW() - INTERVAL '5 days'
      ) RETURNING * INTO post_record;
      
      -- Add 2 responses to post 2
      response_fruit := fruit_names[1 + ((course_idx * 3 + 3) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'I''d be interested! When were you thinking of meeting? I''m free most evenings.'
          WHEN 2 THEN 'That sounds interesting! I''m working on something similar. Maybe we could discuss collaboration?'
          WHEN 3 THEN 'I found the online tutorials really helpful, especially for the coding parts. Also, the practice problems at the end of each chapter are great.'
          WHEN 4 THEN 'Count me in! I think meeting twice a week would be ideal.'
          WHEN 5 THEN 'I''ve been using spaced repetition for memorizing key concepts. It''s been really effective!'
          WHEN 6 THEN 'I''m available most afternoons. How about we set up a recurring meeting?'
          ELSE 'Great idea! I''m interested in joining.'
        END,
        NOW() - INTERVAL '4 days',
        NOW() - INTERVAL '4 days'
      );
      
      response_fruit := fruit_names[1 + ((course_idx * 3 + 4) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'I''m in too! Should we create a group chat to coordinate?'
          WHEN 2 THEN 'I have some ideas we could explore. Let me know when you want to discuss!'
          WHEN 3 THEN 'The online forum discussions are also really valuable for understanding different perspectives.'
          WHEN 4 THEN 'Same here! I think having a structured schedule would help us stay on track.'
          WHEN 5 THEN 'I''ve been making summary sheets for each topic. Happy to share if others find it useful!'
          WHEN 6 THEN 'I prefer online meetings if that works for everyone. More flexible with scheduling.'
          ELSE 'Sounds good! Let''s coordinate.'
        END,
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '3 days'
      );
      
      UPDATE chat_posts SET response_count = 2 WHERE id = post_record.id;
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 3: Course-specific general question
      selected_fruit := fruit_names[1 + ((course_idx * 3 + 5) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        CASE course_idx
          WHEN 1 THEN 'When Are Office Hours?'
          WHEN 2 THEN 'Textbook Question'
          WHEN 3 THEN 'Grading Policy Clarification'
          WHEN 4 THEN 'Course Schedule Question'
          WHEN 5 THEN 'Software Installation Help'
          WHEN 6 THEN 'Assignment Submission Format'
          ELSE 'General Course Question'
        END,
        CASE course_idx
          WHEN 1 THEN 'I noticed the professor mentioned office hours in the last lecture, but I couldn''t catch the exact time and location. Does anyone know when they are? Are they in person or virtual this semester?'
          WHEN 2 THEN 'Is the textbook required for this course? I see it listed in the syllabus but haven''t needed it yet. Should I get it now or can I wait?'
          WHEN 3 THEN 'I''m confused about the grading breakdown. The syllabus says 40% exams, 30% assignments, and 30% project, but I thought there were more components. Can someone clarify?'
          WHEN 4 THEN 'I missed the first class and want to make sure I understand the course schedule. Are there any important dates I should be aware of?'
          WHEN 5 THEN 'I''m having trouble installing the required software for the labs. The installation keeps failing. Has anyone else had this issue and found a solution?'
          WHEN 6 THEN 'For the assignments, should we submit just the code files or also include a README with explanations? The instructions weren''t entirely clear on this.'
          ELSE 'I have a general question about the course and would appreciate any help.'
        END,
        'other',
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      ) RETURNING * INTO post_record;
      
      -- Add 1 response to post 3
      response_fruit := fruit_names[1 + ((course_idx * 3 + 6) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'Office hours are Tuesdays and Thursdays from 2-4 PM in the CS building, room 123. They''re in person this semester.'
          WHEN 2 THEN 'The textbook is helpful but not strictly required. I''d recommend getting it if you want extra practice problems, but you can get by with just the lecture materials.'
          WHEN 3 THEN 'I think the 30% project includes the final project and smaller project components. The breakdown should add up correctly if you include everything.'
          WHEN 4 THEN 'The midterm is in 3 weeks, and the final project proposal is due next Friday. Make sure to check the course calendar for all dates.'
          WHEN 5 THEN 'Try running the installer as administrator and make sure you have the latest version. Also check if your antivirus is blocking it.'
          WHEN 6 THEN 'I usually submit both - the code files and a brief README explaining my approach. It never hurts to be thorough!'
          ELSE 'That''s a good question. I''d suggest checking the course materials or asking the professor directly.'
        END,
        NOW() - INTERVAL '12 hours',
        NOW() - INTERVAL '12 hours'
      );
      
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 4: Course-specific discussion
      selected_fruit := fruit_names[1 + ((course_idx * 3 + 7) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        CASE course_idx
          WHEN 1 THEN 'Interesting Article Related to Course'
          WHEN 2 THEN 'Real-World Application Discussion'
          WHEN 3 THEN 'Career Paths in This Field'
          WHEN 4 THEN 'Latest Research in This Area'
          WHEN 5 THEN 'Industry Trends Discussion'
          WHEN 6 THEN 'Future Applications of Course Material'
          ELSE 'Course-Related Discussion'
        END,
        CASE course_idx
          WHEN 1 THEN 'I came across this interesting article that relates directly to what we''re learning in class. It discusses recent developments in the field and thought others might find it relevant. Would love to hear your thoughts!'
          WHEN 2 THEN 'I''ve been thinking about how the concepts we''re learning apply in real-world scenarios. Has anyone worked on projects outside of class that use these techniques? Would be great to discuss practical applications.'
          WHEN 3 THEN 'For those considering careers in this field, what paths are you thinking about? I''m curious about different career options and what skills are most valuable.'
          WHEN 4 THEN 'I read about some recent research that builds on what we covered in lecture. It''s fascinating how the field is evolving. Anyone else following recent developments?'
          WHEN 5 THEN 'The industry seems to be moving in interesting directions. I''m curious what trends others are noticing and how they relate to our coursework.'
          WHEN 6 THEN 'I''ve been thinking about how the material we''re learning could be applied in future projects or research. What applications are you most excited about?'
          ELSE 'Let''s discuss how the course material relates to broader topics in the field!'
        END,
        'discussion',
        NOW() - INTERVAL '7 days',
        NOW() - INTERVAL '7 days'
      ) RETURNING * INTO post_record;
      
      -- Add 1 response
      response_fruit := fruit_names[1 + ((course_idx * 3 + 8) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'Thanks for sharing! I''ll definitely check it out. It''s always interesting to see how theory connects to practice.'
          WHEN 2 THEN 'I''ve used some of these concepts in a side project. It''s amazing how applicable the material is to real problems.'
          WHEN 3 THEN 'I''m considering both research and industry paths. The skills from this course seem valuable for either direction.'
          WHEN 4 THEN 'The research in this area is moving so fast! It''s exciting to see how quickly things are developing.'
          WHEN 5 THEN 'I''ve noticed similar trends. It''s important to stay updated with industry developments alongside coursework.'
          WHEN 6 THEN 'I''m particularly interested in applications related to data analysis. The possibilities seem endless!'
          ELSE 'Great discussion topic! I''d love to hear more perspectives on this.'
        END,
        NOW() - INTERVAL '6 days',
        NOW() - INTERVAL '6 days'
      );
      
      UPDATE chat_posts SET response_count = 1 WHERE id = post_record.id;
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;

      -- Post 5: Course-specific problem
      selected_fruit := fruit_names[1 + ((course_idx * 3 + 9) % array_length(fruit_names, 1))];
      INSERT INTO chat_posts (course_id, user_id, anonymous_thread_id, title, body, tag, created_at, updated_at)
      VALUES (
        course_id_val,
        sample_user_id,
        selected_fruit,
        CASE course_idx
          WHEN 1 THEN 'Debugging Help Needed'
          WHEN 2 THEN 'Algorithm Implementation Issue'
          WHEN 3 THEN 'Code Not Working as Expected'
          WHEN 4 THEN 'Runtime Error Troubleshooting'
          WHEN 5 THEN 'Logic Error in Assignment'
          WHEN 6 THEN 'Performance Issue with Solution'
          ELSE 'Technical Problem'
        END,
        CASE course_idx
          WHEN 1 THEN 'I''ve been debugging my code for hours but can''t figure out why it''s not working. I keep getting an error message but it''s not very descriptive. Has anyone encountered something similar or have suggestions for debugging strategies?'
          WHEN 2 THEN 'I understand the algorithm conceptually but I''m having trouble implementing it correctly. My code runs but produces incorrect results. Any tips on how to verify each step?'
          WHEN 3 THEN 'My code compiles and runs, but the output isn''t what I expected. I''ve gone through it multiple times but can''t spot the issue. Would appreciate any help or fresh perspective.'
          WHEN 4 THEN 'I''m getting a runtime error that I can''t trace. The error occurs intermittently which makes it even harder to debug. Has anyone seen this before or know common causes?'
          WHEN 5 THEN 'I think there''s a logic error in my solution but I can''t pinpoint where. The code structure looks correct to me. Any suggestions on how to systematically find the issue?'
          WHEN 6 THEN 'My solution works correctly but it''s too slow for the larger test cases. I''ve tried optimizing but can''t seem to improve the performance. Any advice on optimization techniques?'
          ELSE 'I''m encountering a technical issue and would appreciate any help or suggestions.'
        END,
        'problem',
        NOW() - INTERVAL '3 days',
        NOW() - INTERVAL '3 days'
      ) RETURNING * INTO post_record;
      
      -- Add 2 responses
      response_fruit := fruit_names[1 + ((course_idx * 3 + 10) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'Try adding print statements or using a debugger to trace through the execution. Also check for common issues like off-by-one errors or uninitialized variables.'
          WHEN 2 THEN 'I''d suggest testing each part of the algorithm separately. Break it down into smaller functions and verify each piece works correctly before combining them.'
          WHEN 3 THEN 'Have you tried walking through your code with sample input manually? Sometimes that helps spot issues that aren''t obvious when just reading the code.'
          WHEN 4 THEN 'Intermittent errors are tricky! Check for race conditions, uninitialized memory, or array bounds issues. Using valgrind or similar tools might help.'
          WHEN 5 THEN 'Try adding assertions at key points to verify your assumptions. Also, consider edge cases - sometimes the logic works for normal cases but fails on edge cases.'
          WHEN 6 THEN 'For performance issues, profile your code to find bottlenecks. Look for nested loops that could be optimized or unnecessary computations that can be cached.'
          ELSE 'That sounds frustrating! Have you tried breaking the problem down into smaller parts?'
        END,
        NOW() - INTERVAL '2 days',
        NOW() - INTERVAL '2 days'
      );
      
      response_fruit := fruit_names[1 + ((course_idx * 3 + 11) % array_length(fruit_names, 1))];
      INSERT INTO chat_responses (post_id, user_id, anonymous_thread_id, body, created_at, updated_at)
      VALUES (
        post_record.id,
        sample_user_id,
        response_fruit,
        CASE course_idx
          WHEN 1 THEN 'Also make sure you''re checking the full error message - sometimes there are details further down that give clues. Stack traces can be very helpful too.'
          WHEN 2 THEN 'Another approach: try implementing a simpler version first to verify the core logic, then add complexity incrementally.'
          WHEN 3 THEN 'Consider using version control to compare working vs non-working versions if you have one. Git diff can help spot what changed.'
          WHEN 4 THEN 'Make sure you''re handling all edge cases and boundary conditions. Those are often where runtime errors occur.'
          WHEN 5 THEN 'Sometimes explaining the problem to someone else (or writing it out) helps you see it differently. Also, take a break and come back with fresh eyes.'
          WHEN 6 THEN 'Consider the time complexity of your approach. There might be a more efficient algorithm or data structure that would help.'
          ELSE 'Don''t hesitate to ask the TA or professor for help - sometimes a quick explanation can save hours of debugging!'
        END,
        NOW() - INTERVAL '1 day',
        NOW() - INTERVAL '1 day'
      );
      
      UPDATE chat_posts SET response_count = 2 WHERE id = post_record.id;
      INSERT INTO thread_access_tracking (user_id, post_id, has_contributed)
      VALUES (sample_user_id, post_record.id, true)
      ON CONFLICT (user_id, post_id) DO NOTHING;
    END;
  END LOOP;

  RAISE NOTICE 'Unique posts seeded successfully for % course(s)!', array_length(sample_course_ids, 1);
END $$;

