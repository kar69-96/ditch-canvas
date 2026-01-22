/**
 * Learn Routes
 * Backend API for AI-powered study platform features
 * - Visual generation with Claude
 * - Tutor chat with LearnLM (Gemini)
 * - CRUD for visuals, tutor sessions
 */

const express = require("express");
const router = express.Router();

// Optional Supabase client
let getSupabaseClient = null;
try {
  getSupabaseClient =
    require("../services/integrations/supabase-client").getSupabaseClient;
} catch (e) {
  console.warn("[learn] Supabase client not available");
}

// Claude API for visual generation
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// Google AI for tutor chat (LearnLM)
const GOOGLE_AI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Generate a visual React component using Claude
 * POST /api/learn/visuals/generate
 */
router.post("/visuals/generate", async (req, res) => {
  try {
    const { topic, courseContext, userEmail } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return res
        .status(500)
        .json({ error: "Anthropic API key not configured" });
    }

    // Build context from course if provided
    let contextPrompt = "";
    if (courseContext) {
      contextPrompt = `\n\nCourse context: ${courseContext}`;
    }

    const systemPrompt = `You are an expert at creating interactive educational visualizations using React. You generate self-contained React components that help students understand complex concepts through interactive demonstrations.

Your visualizations should:
1. Be completely self-contained (no external imports except React hooks)
2. Use inline styles or Tailwind CSS classes
3. Include interactive controls (sliders, buttons) for key parameters
4. Use canvas or SVG for graphics when appropriate
5. Include educational labels and explanations within the component
6. Be visually appealing with good color choices
7. Include smooth animations where helpful

Return ONLY the React component code, starting with the function declaration. Do not include any markdown, explanation, or import statements. The component should be named "Visualization".

Example format:
function Visualization() {
  const [value, setValue] = React.useState(1);
  // ... rest of component
  return (
    <div>
      {/* visualization content */}
    </div>
  );
}`;

    const userPrompt = `Create an interactive React component to visualize and explain: ${topic}${contextPrompt}

The visualization should help students understand this concept through hands-on interaction. Include controls that let users experiment with different parameters and see the effects in real-time.`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error("[learn] Claude API error:", errorData);
      return res
        .status(500)
        .json({ error: "Failed to generate visual", details: errorData });
    }

    const data = await response.json();
    const componentCode = data.content[0]?.text || "";

    // Clean up the component code
    let cleanCode = componentCode
      .replace(/```jsx?\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    // Save to database if user email provided
    let visualId = null;
    if (userEmail && getSupabaseClient) {
      try {
        const supabase = getSupabaseClient();
        const { data: visual, error } = await supabase
          .from("learn_visuals")
          .insert({
            user_email: userEmail.toLowerCase().trim(),
            title: `${topic.substring(0, 50)}${topic.length > 50 ? "..." : ""}`,
            topic,
            component_code: cleanCode,
            parameters: {},
          })
          .select("id")
          .single();

        if (!error && visual) {
          visualId = visual.id;
        }
      } catch (dbError) {
        console.warn(
          "[learn] Failed to save visual to database:",
          dbError.message,
        );
      }
    }

    res.json({
      success: true,
      componentCode: cleanCode,
      visualId,
      topic,
    });
  } catch (error) {
    console.error("[learn] Error generating visual:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

/**
 * Get saved visuals for a user
 * GET /api/learn/visuals
 */
router.get("/visuals", async (req, res) => {
  try {
    const { userEmail, courseId } = req.query;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("learn_visuals")
      .select("*")
      .eq("user_email", userEmail.toLowerCase().trim())
      .order("created_at", { ascending: false });

    if (courseId) {
      query = query.eq("course_id", courseId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[learn] Error fetching visuals:", error);
      return res.status(500).json({ error: "Failed to fetch visuals" });
    }

    res.json({ visuals: data || [] });
  } catch (error) {
    console.error("[learn] Error fetching visuals:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get a specific visual by ID
 * GET /api/learn/visuals/:id
 */
router.get("/visuals/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("learn_visuals")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Visual not found" });
    }

    res.json({ visual: data });
  } catch (error) {
    console.error("[learn] Error fetching visual:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Delete a visual
 * DELETE /api/learn/visuals/:id
 */
router.delete("/visuals/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("learn_visuals")
      .delete()
      .eq("id", id)
      .eq("user_email", userEmail.toLowerCase().trim());

    if (error) {
      console.error("[learn] Error deleting visual:", error);
      return res.status(500).json({ error: "Failed to delete visual" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[learn] Error deleting visual:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Chat with AI tutor (LearnLM via Gemini)
 * POST /api/learn/tutor/chat
 */
router.post("/tutor/chat", async (req, res) => {
  try {
    const { sessionId, message, userEmail, courseContext, topic } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const googleKey =
      process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!googleKey) {
      return res
        .status(500)
        .json({ error: "Google AI API key not configured" });
    }

    // Get or create session
    let session = null;
    let messages = [];

    if (sessionId && getSupabaseClient) {
      const supabase = getSupabaseClient();
      const { data } = await supabase
        .from("learn_tutor_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (data) {
        session = data;
        messages = data.messages || [];
      }
    }

    // Build conversation history for context
    const conversationHistory = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Add current message
    conversationHistory.push({
      role: "user",
      parts: [{ text: message }],
    });

    // Build system instruction for LearnLM/Gemini
    let systemInstruction = `You are LearnLM, an AI tutor specialized in helping students learn through the Socratic method. Your role is to:

1. Guide students to discover answers themselves through thoughtful questions
2. Break down complex concepts into manageable pieces
3. Provide encouragement and positive reinforcement
4. Give hints rather than direct answers when students struggle
5. Use analogies and real-world examples to explain abstract concepts
6. Check understanding before moving to new topics
7. Adapt your explanations based on the student's level of understanding

When a student asks a question:
- First, try to understand what they already know
- Ask clarifying questions to gauge their understanding
- Guide them step by step toward the answer
- Only provide direct explanations when they're truly stuck

Be warm, patient, and encouraging. Celebrate small victories and normalize making mistakes as part of learning.`;

    if (courseContext) {
      systemInstruction += `\n\nCourse context: ${courseContext}`;
    }
    if (topic) {
      systemInstruction += `\n\nCurrent topic: ${topic}`;
    }

    // Use LearnLM model if available, fall back to Gemini
    const modelId = "learnlm-2.0-flash-experimental"; // LearnLM model
    const fallbackModelId = "gemini-2.0-flash";

    let responseText = "";

    // Try LearnLM first
    try {
      responseText = await callGoogleAI(
        googleKey,
        modelId,
        systemInstruction,
        conversationHistory,
      );
    } catch (learnlmError) {
      console.warn(
        "[learn] LearnLM not available, falling back to Gemini:",
        learnlmError.message,
      );
      try {
        responseText = await callGoogleAI(
          googleKey,
          fallbackModelId,
          systemInstruction,
          conversationHistory,
        );
      } catch (geminiError) {
        console.error("[learn] Gemini also failed:", geminiError);
        return res.status(500).json({ error: "AI service unavailable" });
      }
    }

    // Update session in database
    let updatedSessionId = sessionId;
    if (userEmail && getSupabaseClient) {
      try {
        const supabase = getSupabaseClient();
        const newMessages = [
          ...messages,
          {
            role: "user",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: responseText,
            timestamp: new Date().toISOString(),
          },
        ];

        if (session) {
          // Update existing session
          await supabase
            .from("learn_tutor_sessions")
            .update({
              messages: newMessages,
              updated_at: new Date().toISOString(),
            })
            .eq("id", sessionId);
        } else {
          // Create new session
          const { data: newSession, error } = await supabase
            .from("learn_tutor_sessions")
            .insert({
              user_email: userEmail.toLowerCase().trim(),
              topic: topic || message.substring(0, 100),
              messages: newMessages,
            })
            .select("id")
            .single();

          if (!error && newSession) {
            updatedSessionId = newSession.id;
          }
        }
      } catch (dbError) {
        console.warn("[learn] Failed to save tutor session:", dbError.message);
      }
    }

    res.json({
      success: true,
      response: responseText,
      sessionId: updatedSessionId,
    });
  } catch (error) {
    console.error("[learn] Error in tutor chat:", error);
    res
      .status(500)
      .json({ error: "Internal server error", message: error.message });
  }
});

/**
 * Helper function to call Google AI API
 */
async function callGoogleAI(apiKey, modelId, systemInstruction, contents) {
  const url = `${GOOGLE_AI_API_URL}/${modelId}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google AI error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  if (!responseText) {
    throw new Error("Empty response from Google AI");
  }

  return responseText;
}

/**
 * Get tutor sessions for a user
 * GET /api/learn/tutor/sessions
 */
router.get("/tutor/sessions", async (req, res) => {
  try {
    const { userEmail, courseId } = req.query;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    let query = supabase
      .from("learn_tutor_sessions")
      .select("id, topic, course_id, created_at, updated_at")
      .eq("user_email", userEmail.toLowerCase().trim())
      .order("updated_at", { ascending: false });

    if (courseId) {
      query = query.eq("course_id", courseId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[learn] Error fetching tutor sessions:", error);
      return res.status(500).json({ error: "Failed to fetch sessions" });
    }

    res.json({ sessions: data || [] });
  } catch (error) {
    console.error("[learn] Error fetching tutor sessions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get a specific tutor session
 * GET /api/learn/tutor/sessions/:id
 */
router.get("/tutor/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("learn_tutor_sessions")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({ session: data });
  } catch (error) {
    console.error("[learn] Error fetching tutor session:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Delete a tutor session
 * DELETE /api/learn/tutor/sessions/:id
 */
router.delete("/tutor/sessions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userEmail } = req.body;

    if (!userEmail) {
      return res.status(400).json({ error: "User email is required" });
    }

    if (!getSupabaseClient) {
      return res.status(500).json({ error: "Database not available" });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("learn_tutor_sessions")
      .delete()
      .eq("id", id)
      .eq("user_email", userEmail.toLowerCase().trim());

    if (error) {
      console.error("[learn] Error deleting session:", error);
      return res.status(500).json({ error: "Failed to delete session" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[learn] Error deleting tutor session:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Generate practice problems
 * POST /api/learn/practice/generate
 */
router.post("/practice/generate", async (req, res) => {
  try {
    const { topic, difficulty, count = 3, courseContext } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const googleKey =
      process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (!googleKey) {
      return res
        .status(500)
        .json({ error: "Google AI API key not configured" });
    }

    const systemInstruction = `You are an expert educator. Generate ${count} practice problems on the given topic. Each problem should:
1. Be clear and well-structured
2. Match the specified difficulty level
3. Include the answer and a brief explanation
4. Help reinforce understanding of the concept

Return the problems in this JSON format:
{
  "problems": [
    {
      "question": "The problem statement",
      "hint": "A helpful hint without giving away the answer",
      "answer": "The correct answer",
      "explanation": "Why this is the answer"
    }
  ]
}`;

    let contextPrompt = "";
    if (courseContext) {
      contextPrompt = `\nCourse context: ${courseContext}`;
    }

    const userMessage = `Generate ${count} practice problems about: ${topic}
Difficulty: ${difficulty || "medium"}${contextPrompt}

Return only valid JSON.`;

    const modelId = "gemini-2.0-flash";

    const response = await fetch(
      `${GOOGLE_AI_API_URL}/${modelId}:generateContent?key=${googleKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: "user", parts: [{ text: userMessage }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2048,
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[learn] Practice generation error:", errorText);
      return res
        .status(500)
        .json({ error: "Failed to generate practice problems" });
    }

    const data = await response.json();
    let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean up JSON response
    responseText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    try {
      const problems = JSON.parse(responseText);
      res.json({ success: true, ...problems });
    } catch (parseError) {
      console.error("[learn] Failed to parse practice problems:", parseError);
      res.json({ success: true, problems: [], raw: responseText });
    }
  } catch (error) {
    console.error("[learn] Error generating practice problems:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
