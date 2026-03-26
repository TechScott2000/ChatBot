// api/chat.js
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Helper to set CORS headers
function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // or your Squarespace domain
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  // Handle preflight
  if (req.method === "OPTIONS") {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== "POST") {
    setCorsHeaders(res);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages } = req.body;

  const systemPrompt = {
    role: "system",
    content: `You are a friendly support assistant for Tech Johnny. Your goal is to gather the following information from the customer:
- Name
- Email
- Company Name
- Property/Location Name
- Detailed description of the issue
- Phone number they will call from
- Whether they have restarted their computer today (Yes/No)
- Which session type they prefer: 5min, 20min, 40min, 60min, or nosub (for clients without subscription)

Ask one question at a time, be conversational, and confirm details when needed.`
  };

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [systemPrompt, ...messages],
      temperature: 0.7,
    });

    const reply = completion.data.choices[0].message.content;
    setCorsHeaders(res);
    return res.status(200).json({ action: "reply", message: reply });
  } catch (error) {
    console.error(error);
    setCorsHeaders(res);
    return res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
}
