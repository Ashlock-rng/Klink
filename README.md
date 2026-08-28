# Klink

Klink is an AI assistant focused on cars and technology.

Built to be helpful, fast, and future-ready — with a long-term vision of becoming a full AI companion for automotive and tech knowledge (similar in spirit to Grok).

## Current Status
This repository is in early development.

## Vision
- AI chat focused on cars, vehicles, and technology
- Useful answers about cars, engines, tech, and related topics
- Expandable in the future with more features and links

## Setup

### 1. Install Dependencies
npm install

### 2. Configure Environment Variables
Copy the example file:
cp .env.example .env

Then open the .env file and add your OpenAI API key:

OPENAI_API_KEY=sk-your-openai-api-key-here
SERVER_API_KEY=your-optional-server-key
PORT=3000

### 3. Start the Server

Development:
npm run dev

Production:
npm start

The server will run on http://localhost:3000

## Deployment

Works on Render, Railway, Heroku, etc.

1. Add environment variables in the platform:
   - OPENAI_API_KEY
   - SERVER_API_KEY (optional)
2. Build command: npm install
3. Start command: npm start

## License
MIT

---

Created by Ashlock-rng
