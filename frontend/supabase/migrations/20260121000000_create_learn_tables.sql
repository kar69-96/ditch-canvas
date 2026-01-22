-- Learn Module Tables
-- Migration for AI-powered study platform features

-- Visual demonstrations (store generated React components)
CREATE TABLE IF NOT EXISTS learn_visuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  course_id TEXT,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  component_code TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tutor sessions (AI tutoring chat history)
CREATE TABLE IF NOT EXISTS learn_tutor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  course_id TEXT,
  topic TEXT,
  messages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flashcard decks
CREATE TABLE IF NOT EXISTS learn_flashcard_decks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  course_id TEXT,
  title TEXT NOT NULL,
  source_type TEXT, -- 'course', 'module', 'assignment', etc.
  source_ids TEXT[], -- Array of source entity IDs
  card_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual flashcards with SM-2 spaced repetition fields
CREATE TABLE IF NOT EXISTS learn_flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id UUID NOT NULL REFERENCES learn_flashcard_decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor DECIMAL(4,2) DEFAULT 2.5,
  interval_days INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quizzes
CREATE TABLE IF NOT EXISTS learn_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  course_id TEXT,
  title TEXT NOT NULL,
  difficulty TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_count INTEGER DEFAULT 0,
  source_type TEXT,
  source_ids TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quiz questions
CREATE TABLE IF NOT EXISTS learn_quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES learn_quizzes(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  correct_answer JSONB NOT NULL, -- { text, explanation }
  wrong_answers JSONB NOT NULL, -- [{ text, explanation }, ...]
  question_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Quiz attempts (history of quiz completions)
CREATE TABLE IF NOT EXISTS learn_quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES learn_quizzes(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total_questions INTEGER NOT NULL,
  answers JSONB NOT NULL, -- [{ questionId, selectedAnswer, isCorrect }, ...]
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Study progress tracking
CREATE TABLE IF NOT EXISTS learn_study_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  course_id TEXT,
  stats JSONB DEFAULT '{}', -- { visualsCreated, tutorSessions, flashcardsStudied, quizzesCompleted, etc. }
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_email, course_id)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_learn_visuals_user_email ON learn_visuals(user_email);
CREATE INDEX IF NOT EXISTS idx_learn_visuals_course_id ON learn_visuals(course_id);
CREATE INDEX IF NOT EXISTS idx_learn_visuals_created_at ON learn_visuals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learn_tutor_sessions_user_email ON learn_tutor_sessions(user_email);
CREATE INDEX IF NOT EXISTS idx_learn_tutor_sessions_course_id ON learn_tutor_sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_learn_tutor_sessions_updated_at ON learn_tutor_sessions(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_learn_flashcard_decks_user_email ON learn_flashcard_decks(user_email);
CREATE INDEX IF NOT EXISTS idx_learn_flashcard_decks_course_id ON learn_flashcard_decks(course_id);

CREATE INDEX IF NOT EXISTS idx_learn_flashcards_deck_id ON learn_flashcards(deck_id);
CREATE INDEX IF NOT EXISTS idx_learn_flashcards_next_review ON learn_flashcards(next_review_at);

CREATE INDEX IF NOT EXISTS idx_learn_quizzes_user_email ON learn_quizzes(user_email);
CREATE INDEX IF NOT EXISTS idx_learn_quizzes_course_id ON learn_quizzes(course_id);

CREATE INDEX IF NOT EXISTS idx_learn_quiz_questions_quiz_id ON learn_quiz_questions(quiz_id);

CREATE INDEX IF NOT EXISTS idx_learn_quiz_attempts_user_email ON learn_quiz_attempts(user_email);
CREATE INDEX IF NOT EXISTS idx_learn_quiz_attempts_quiz_id ON learn_quiz_attempts(quiz_id);

CREATE INDEX IF NOT EXISTS idx_learn_study_progress_user_email ON learn_study_progress(user_email);

-- Enable RLS on all learn tables
ALTER TABLE learn_visuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_tutor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_flashcard_decks ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_flashcards ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_quiz_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE learn_study_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Users can only access their own data
CREATE POLICY "Users can view own visuals" ON learn_visuals FOR SELECT USING (true);
CREATE POLICY "Users can insert own visuals" ON learn_visuals FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own visuals" ON learn_visuals FOR UPDATE USING (true);
CREATE POLICY "Users can delete own visuals" ON learn_visuals FOR DELETE USING (true);

CREATE POLICY "Users can view own tutor sessions" ON learn_tutor_sessions FOR SELECT USING (true);
CREATE POLICY "Users can insert own tutor sessions" ON learn_tutor_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own tutor sessions" ON learn_tutor_sessions FOR UPDATE USING (true);
CREATE POLICY "Users can delete own tutor sessions" ON learn_tutor_sessions FOR DELETE USING (true);

CREATE POLICY "Users can view own flashcard decks" ON learn_flashcard_decks FOR SELECT USING (true);
CREATE POLICY "Users can insert own flashcard decks" ON learn_flashcard_decks FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own flashcard decks" ON learn_flashcard_decks FOR UPDATE USING (true);
CREATE POLICY "Users can delete own flashcard decks" ON learn_flashcard_decks FOR DELETE USING (true);

CREATE POLICY "Users can view flashcards" ON learn_flashcards FOR SELECT USING (true);
CREATE POLICY "Users can insert flashcards" ON learn_flashcards FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update flashcards" ON learn_flashcards FOR UPDATE USING (true);
CREATE POLICY "Users can delete flashcards" ON learn_flashcards FOR DELETE USING (true);

CREATE POLICY "Users can view own quizzes" ON learn_quizzes FOR SELECT USING (true);
CREATE POLICY "Users can insert own quizzes" ON learn_quizzes FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own quizzes" ON learn_quizzes FOR UPDATE USING (true);
CREATE POLICY "Users can delete own quizzes" ON learn_quizzes FOR DELETE USING (true);

CREATE POLICY "Users can view quiz questions" ON learn_quiz_questions FOR SELECT USING (true);
CREATE POLICY "Users can insert quiz questions" ON learn_quiz_questions FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update quiz questions" ON learn_quiz_questions FOR UPDATE USING (true);
CREATE POLICY "Users can delete quiz questions" ON learn_quiz_questions FOR DELETE USING (true);

CREATE POLICY "Users can view own quiz attempts" ON learn_quiz_attempts FOR SELECT USING (true);
CREATE POLICY "Users can insert own quiz attempts" ON learn_quiz_attempts FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own study progress" ON learn_study_progress FOR SELECT USING (true);
CREATE POLICY "Users can insert own study progress" ON learn_study_progress FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update own study progress" ON learn_study_progress FOR UPDATE USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_learn_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_learn_visuals_updated_at
  BEFORE UPDATE ON learn_visuals
  FOR EACH ROW EXECUTE FUNCTION update_learn_updated_at();

CREATE TRIGGER update_learn_tutor_sessions_updated_at
  BEFORE UPDATE ON learn_tutor_sessions
  FOR EACH ROW EXECUTE FUNCTION update_learn_updated_at();

CREATE TRIGGER update_learn_flashcard_decks_updated_at
  BEFORE UPDATE ON learn_flashcard_decks
  FOR EACH ROW EXECUTE FUNCTION update_learn_updated_at();

CREATE TRIGGER update_learn_flashcards_updated_at
  BEFORE UPDATE ON learn_flashcards
  FOR EACH ROW EXECUTE FUNCTION update_learn_updated_at();

CREATE TRIGGER update_learn_study_progress_updated_at
  BEFORE UPDATE ON learn_study_progress
  FOR EACH ROW EXECUTE FUNCTION update_learn_updated_at();
