require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Optional API key protection
const SERVER_API_KEY = process.env.SERVER_API_KEY;

function requireApiKey(req, res, next) {
  if (!SERVER_API_KEY) return next();
  const key = req.headers["x-api-key"];
  if (key !== SERVER_API_KEY) {
    return res.status(401).json({ error: "Unauthorized – invalid or missing X-API-KEY" });
  }
  next();
}

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", hasOpenAIKey: !!process.env.OPENAI_API_KEY });
});

// Chat endpoint - Klink AI
app.post("/api/chat", requireApiKey, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
    }

    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Add Klink system personality if not already present
    const hasSystem = messages.some(m => m.role === "system");
    const finalMessages = hasSystem
      ? messages
      : [
          {
            role: "system",
            content:
              "You are Klink, a helpful AI assistant focused on cars and technology. You give clear, accurate, and friendly answers about vehicles, engines, tech, and related topics.",
          },
          ...messages,
        ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: finalMessages,
      temperature: 0.7,
    });

    const reply = completion.choices[0]?.message?.content || "No response generated.";

    res.json({ reply });
  } catch (error) {
    console.error("OpenAI error:", error);
    res.status(500).json({
      error: "Failed to get response from OpenAI",
      details: error.message,
    });
  }
});

// Fallback to frontend
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Klink server running on http://localhost:${PORT}`);
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠️  OPENAI_API_KEY is missing – /api/chat will fail");
  }
  if (SERVER_API_KEY) {
    console.log("🔒 SERVER_API_KEY is set – requests require X-API-KEY header");
  }
});
