/**
 * Quiz Extractor
 * Extracts quiz content and metadata from Canvas
 */

/**
 * Extracts quiz data from a Canvas quiz page
 * @param {Object} page - Playwright page object
 * @param {string} url - The quiz URL
 * @returns {Promise<Object>} - Quiz data object
 */
async function extractQuiz(page, url) {
  try {
    // Extract course ID and quiz ID from URL
    const courseIdMatch = url.match(/\/courses\/(\d+)/);
    const courseId = courseIdMatch ? courseIdMatch[1] : null;
    
    const quizIdMatch = url.match(/\/quizzes\/(\d+)/);
    const quizId = quizIdMatch ? quizIdMatch[1] : null;

    const quizData = {
      quizId,
      courseId,
      url,
      extractedAt: new Date().toISOString(),
    };

    // Wait for page content to load
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    await page.waitForSelector('h1, h2, .quiz-title, .quiz, main', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000); // Wait for dynamic content

    // Wait for title to be visible
    await page.waitForFunction(() => {
      const h1 = document.querySelector('h1');
      const h2 = document.querySelector('h2');
      if (h1 && h1.textContent.trim() && !h1.textContent.includes('Loading')) return true;
      if (h2 && h2.textContent.trim() && !h2.textContent.includes('Loading')) return true;
      return false;
    }, { timeout: 5000 }).catch(() => {});

    // Extract quiz title
    const title = await page.evaluate(() => {
      const titleSelectors = [
        'h1',
        'h2',
        '.quiz-title',
        '.ig-header-title',
        '[data-testid="quiz-title"]',
        'header h1, header h2'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl) {
          const text = titleEl.textContent.trim();
          if (text && text.length > 0 && !text.includes('Loading') && text !== 'Canvas') {
            return text;
          }
        }
      }
      
      return null;
    });
    quizData.title = title;

    // Wait for quiz description/content to load
    await page.waitForFunction(() => {
      const contentIndicators = [
        '.user_content',
        '.quiz-description',
        '.quiz-instructions',
        '.description'
      ];
      
      for (const selector of contentIndicators) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          return text && text.length > 10 && !text.includes('Loading');
        }
      }
      return false;
    }, { timeout: 8000 }).catch(() => {});
    
    await page.waitForTimeout(1500);

    // Extract quiz description/instructions
    const description = await page.evaluate(() => {
      const descSelectors = [
        '.quiz-description',
        '.quiz-instructions',
        '.user_content',
        '.description',
        '[data-testid="quiz-description"]',
        '.quiz-details .description'
      ];
      
      for (const selector of descSelectors) {
        const descEl = document.querySelector(selector);
        if (descEl) {
          const html = descEl.innerHTML.trim();
          const text = descEl.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      // Try to find in main content area
      const mainContent = document.querySelector('main, .main-content, .content-wrapper, #content');
      if (mainContent) {
        const userContent = mainContent.querySelector('.user_content, .quiz-description, .description');
        if (userContent) {
          const html = userContent.innerHTML.trim();
          const text = userContent.textContent.trim();
          if (html && html.length > 20 && text && text.length > 5 && !text.includes('Loading')) {
            return html;
          }
        }
      }
      
      return null;
    });
    quizData.description = description;
    quizData.descriptionText = description ? 
      await page.evaluate((html) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      }, description) : null;

    // Extract quiz metadata
    const metadata = await page.evaluate(() => {
      const meta = {
        points: null,
        timeLimit: null,
        attempts: null,
        dueDate: null,
        availableFrom: null,
        availableUntil: null,
        questionCount: null,
        isPublished: true,
        isGraded: false,
        shuffleAnswers: false
      };

      // Extract points
      const pointsEl = document.querySelector('.points-possible, .quiz-points, [data-testid="points"]');
      if (pointsEl) {
        const text = pointsEl.textContent.trim();
        const match = text.match(/(\d+(?:\.\d+)?)\s*points?/i) || text.match(/(\d+(?:\.\d+)?)/);
        if (match) {
          meta.points = parseFloat(match[1]);
        }
      }

      // Extract time limit
      const timeLimitEl = document.querySelector('.time-limit, .quiz-time-limit, [data-testid="time-limit"]');
      if (timeLimitEl) {
        meta.timeLimit = timeLimitEl.textContent.trim();
      }

      // Extract attempts
      const attemptsEl = document.querySelector('.attempts, .quiz-attempts, [data-testid="attempts"]');
      if (attemptsEl) {
        const text = attemptsEl.textContent.trim();
        const match = text.match(/(\d+)/);
        if (match) {
          meta.attempts = parseInt(match[1]);
        }
      }

      // Extract due date
      const dueDateEl = document.querySelector('.due-date, .quiz-due-date, [data-testid="due-date"]');
      if (dueDateEl) {
        meta.dueDate = dueDateEl.getAttribute('datetime') || 
                      dueDateEl.getAttribute('title') ||
                      dueDateEl.textContent.trim();
      }

      // Extract availability dates
      const availableFromEl = document.querySelector('.available-from, .quiz-available-from');
      if (availableFromEl) {
        meta.availableFrom = availableFromEl.getAttribute('datetime') || 
                            availableFromEl.textContent.trim();
      }

      const availableUntilEl = document.querySelector('.available-until, .quiz-available-until');
      if (availableUntilEl) {
        meta.availableUntil = availableUntilEl.getAttribute('datetime') || 
                             availableUntilEl.textContent.trim();
      }

      // Extract question count
      const questionCountEl = document.querySelector('.question-count, .quiz-question-count');
      if (questionCountEl) {
        const text = questionCountEl.textContent.trim();
        const match = text.match(/(\d+)/);
        if (match) {
          meta.questionCount = parseInt(match[1]);
        }
      }

      // Check published status
      const unpublishedEl = document.querySelector('.unpublished, [data-testid="unpublished"]');
      meta.isPublished = !unpublishedEl;

      // Check if graded
      const gradedEl = document.querySelector('.graded, [data-testid="graded"]');
      meta.isGraded = !!gradedEl;

      // Check shuffle answers
      const shuffleEl = document.querySelector('.shuffle-answers, [data-testid="shuffle-answers"]');
      meta.shuffleAnswers = !!shuffleEl;

      return meta;
    });
    quizData.metadata = metadata;

    // Extract questions (if accessible - may require instructor permissions)
    const questions = await page.evaluate(() => {
      const questions = [];
      
      // Try to find question elements
      const questionElements = document.querySelectorAll('.question, .quiz-question, [data-testid="question"]');
      
      questionElements.forEach((questionEl, index) => {
        const question = {
          questionNumber: index + 1,
          questionId: null,
          type: null,
          text: null,
          points: null,
          answers: []
        };

        // Extract question ID
        question.questionId = questionEl.getAttribute('id') || 
                             questionEl.getAttribute('data-id') ||
                             questionEl.getAttribute('data-question-id');

        // Extract question type
        const typeEl = questionEl.querySelector('.question-type, [data-testid="question-type"]');
        if (typeEl) {
          question.type = typeEl.textContent.trim();
        } else {
          // Try to infer from structure
          if (questionEl.querySelector('.multiple-choice, .multiple_choice')) {
            question.type = 'multiple_choice';
          } else if (questionEl.querySelector('.true-false, .true_false')) {
            question.type = 'true_false';
          } else if (questionEl.querySelector('.essay, .essay_question')) {
            question.type = 'essay';
          } else if (questionEl.querySelector('.fill-in-blank, .fill_in_blank')) {
            question.type = 'fill_in_blank';
          }
        }

        // Extract question text
        const textEl = questionEl.querySelector('.question-text, .question_text, .question-content');
        if (textEl) {
          question.text = textEl.textContent.trim();
        }

        // Extract points
        const pointsEl = questionEl.querySelector('.points, .question-points');
        if (pointsEl) {
          const text = pointsEl.textContent.trim();
          const match = text.match(/(\d+(?:\.\d+)?)/);
          if (match) {
            question.points = parseFloat(match[1]);
          }
        }

        // Extract answers (for multiple choice, etc.)
        const answerElements = questionEl.querySelectorAll('.answer, .answer-option, .choice');
        answerElements.forEach(answerEl => {
          const answer = {
            text: null,
            isCorrect: false
          };

          answer.text = answerEl.textContent.trim();
          
          // Check if this is the correct answer
          const correctIndicator = answerEl.querySelector('.correct, .is-correct, [data-correct="true"]');
          answer.isCorrect = !!correctIndicator;

          if (answer.text) {
            question.answers.push(answer);
          }
        });

        if (question.text || question.questionId) {
          questions.push(question);
        }
      });
      
      return questions;
    });
    quizData.questions = questions;
    quizData.questionCount = questions.length;

    // Extract attachments
    const attachments = await page.evaluate(() => {
      const attachments = [];
      const attachmentSelectors = [
        '.attachment a',
        '.file a',
        'a[href*="/files/"]',
        '[data-testid="attachment"]'
      ];
      
      attachmentSelectors.forEach(selector => {
        const links = document.querySelectorAll(selector);
        links.forEach(link => {
          const href = link.getAttribute('href');
          const name = link.textContent.trim() || link.getAttribute('title') || null;
          if (href && name) {
            attachments.push({
              name,
              url: href.startsWith('http') ? href : new URL(href, window.location.href).href,
              type: href.match(/\.(\w+)(?:\?|$)/)?.[1] || null
            });
          }
        });
      });
      
      return attachments;
    });
    quizData.attachments = attachments;

    return quizData;
  } catch (error) {
    return {
      url,
      error: error.message,
      extractedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  extractQuiz
};
