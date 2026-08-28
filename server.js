require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "15mb" })); // important for images
app.use(express.static(path.join(__dirname, "public")));

// ===== CAR DATABASE (optional) =====
let cars = [];
try {
  const carsFile = path.join(__dirname, "cars.json");
  if (fs.existsSync(carsFile)) {
    cars = JSON.parse(fs.readFileSync(carsFile, "utf8"));
    console.log(`Loaded ${cars.length} cars`);
  }
} catch (err) {
  console.log("No cars.json found");
}

// ===== MEMORY =====
const MEMORY_FILE = path.join(__dirname, "memory.json");

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
    }
  } catch (err) {}
  return [];
}

function saveMemory(messages) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error("Error saving memory:", err);
  }
}

let conversationHistory = loadMemory();

// ===== TOOLS =====
const tools = [
  {
    type: "function",
    function: {
      name: "search_cars",
      description: "Search the car database by make, model, year, type, or fuel",
      parameters: {
        type: "object",
        properties: {
          make: { type: "string" },
          model: { type: "string" },
          year: { type: "number" },
          type: { type: "string" },
          fuel: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_car_by_id",
      description: "Get full details of a car by its ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "number" }
        },
        required: ["id"]
      }
    }
  }
];

function search_cars({ make, model, year, type, fuel }) {
  let results = [...cars];
  if (make) results = results.filter(c => c.make?.toLowerCase().includes(make.toLowerCase()));
  if (model) results = results.filter(c => c.model?.toLowerCase().includes(model.toLowerCase()));
  if (year) results = results.filter(c => c.year === Number(year));
  if (type) results = results.filter(c => c.type?.toLowerCase().includes(type.toLowerCase()));
  if (fuel) results = results.filter(c => c.fuel?.toLowerCase().includes(fuel.toLowerCase()));
  return results.slice(0, 10);
}

function get_car_by_id({ id }) {
  return cars.find(c => c.id === Number(id)) || { error: "Car not found" };
}

const availableTools = { search_cars, get_car_by_id };

// ===== OPENAI =====
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const SERVER_API_KEY = process.env.SERVER_API_KEY;

function requireApiKey(req, res, next) {
  if (!SERVER_API_KEY) return next();
  if (req.headers["x-api-key"] !== SERVER_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    carsLoaded: cars.length,
    memoryMessages: conversationHistory.length
  });
});

app.post("/api/memory/clear", requireApiKey, (req, res) => {
  conversationHistory = [];
  saveMemory([]);
  res.json({ success: true });
});

// ===== MAIN CHAT (with image support) =====
app.post("/api/chat", async (req, res) => {
  try {
    const { message, image } = req.body;

    if (!message && !image) {
      return res.status(400).json({ error: "message or image is required" });
    }

    // Build content for OpenAI (text + image)
    let userContent = [];

    if (message) {
      userContent.push({ type: "text", text: message });
    }

    if (image) {
      userContent.push({
        type: "image_url",
        image_url: { url: image }
      });
    }

    // Save to history (text only)
    conversationHistory.push({
      role: "user",
      content: message || "[User sent an image]"
    });

    if (conversationHistory.length > 16) {
      conversationHistory = conversationHistory.slice(-16);
    }

    let messages = [
      {
        role: "system",
        content: `You are Klink, an expert AI specialized in cars, vehicles, and technology.

You can see images and read any text inside them.

Your main strengths:
- Designing and conceptualizing new cars, vehicles, machines, and tech products
- Creating detailed specifications
- Listing required components and materials
- Explaining how to build things step-by-step
- Giving estimated cost, difficulty, and safety notes
- Reading and understanding images (cars, diagrams, text, etc.)

Be creative, practical, detailed, and safety-conscious.`
      },
      ...conversationHistory.slice(0, -1),
      {
        role: "user",
        content: userContent
      }
    ];

    // First API call
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1500
    });

    let assistantMessage = response.choices[0].message;

    // Handle tool calls
    if (assistantMessage.tool_calls) {
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || "{}");
        console.log(`Tool used: ${functionName}`, args);

        const result = availableTools[functionName](args);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result)
        });
      }

      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7,
        max_tokens: 1500
      });

      assistantMessage = response.choices[0].message;
    }

    const reply = assistantMessage.content || "I couldn't generate a response.";

    conversationHistory.push({ role: "assistant", content: reply });
    saveMemory(conversationHistory);

    res.json({ reply });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to process request",
      details: error.message
    });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Klink server running on port ${PORT}`);
});
