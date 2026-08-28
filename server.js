
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== LOAD CAR DATABASE =====
const CARS_FILE = path.join(__dirname, "cars.json");
let cars = [];
try {
  cars = JSON.parse(fs.readFileSync(CARS_FILE, "utf8"));
  console.log(`Loaded ${cars.length} cars into database`);
} catch (err) {
  console.error("Could not load cars.json", err);
}

// ===== PERSISTENT MEMORY =====
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
          make: { type: "string", description: "Car make (e.g. Toyota, Ford, Tesla)" },
          model: { type: "string", description: "Car model (e.g. Corolla, F-150)" },
          year: { type: "number", description: "Year of the car" },
          type: { type: "string", description: "Type: Sedan, Truck, Sports, SUV, etc." },
          fuel: { type: "string", description: "Fuel type: Gasoline, Electric, Hybrid, Diesel" }
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
          id: { type: "number", description: "The car ID" }
        },
        required: ["id"]
      }
    }
  }
];

function search_cars({ make, model, year, type, fuel }) {
  let results = [...cars];
  if (make) results = results.filter(c => c.make.toLowerCase().includes(make.toLowerCase()));
  if (model) results = results.filter(c => c.model.toLowerCase().includes(model.toLowerCase()));
  if (year) results = results.filter(c => c.year === Number(year));
  if (type) results = results.filter(c => c.type?.toLowerCase().includes(type.toLowerCase()));
  if (fuel) results = results.filter(c => c.fuel?.toLowerCase().includes(fuel.toLowerCase()));
  return results.slice(0, 10);
}

function get_car_by_id({ id }) {
  return cars.find(c => c.id === Number(id)) || { error: "Car not found" };
}

const availableTools = {
  search_cars,
  get_car_by_id
};

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

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    carsLoaded: cars.length,
    memoryMessages: conversationHistory.length
  });
});

// Memory
app.get("/api/memory", (req, res) => {
  res.json({ messages: conversationHistory });
});

app.post("/api/memory/clear", requireApiKey, (req, res) => {
  conversationHistory = [];
  saveMemory([]);
  res.json({ success: true });
});

// ===== MAIN CHAT =====
app.post("/api/chat", requireApiKey, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "message is required" });

    conversationHistory.push({ role: "user", content: message });

    // Keep last 16 messages
    if (conversationHistory.length > 16) {
      conversationHistory = conversationHistory.slice(-16);
    }

    let messages = [
      {
        role: "system",
        content: `You are Klink, an expert AI specialized in cars, vehicles, and all kinds of technology.

Your main strengths:
- Designing and conceptualizing new cars, vehicles, machines, and tech products
- Creating detailed specifications
- Listing all required components, parts, and materials
- Explaining how to construct or build things step-by-step (practical and high-level)
- Giving estimated cost, difficulty level, time required, and safety notes
- Helping with both realistic builds and creative/futuristic concepts

When the user asks you to "create", "design", "build", "invent", or "construct" something:
1. Describe the concept clearly
2. Give full specifications
3. List all required parts/components
4. Provide a clear step-by-step construction guide
5. Add estimated cost, difficulty, and important tips

You also have access to a real car database — use the tools when the user asks about existing cars.

Be creative, practical, detailed, and safety-conscious.`
      },
      ...conversationHistory
    ];

    // First API call
    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.7
    });

    let assistantMessage = response.choices[0].message;

    // Handle tool calls if any
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

      // Second call with tool results
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
        temperature: 0.7
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
  console.log(`Klink server running on http://localhost:${PORT}`);
});
