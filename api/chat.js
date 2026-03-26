// api/chat.js
import { Configuration, OpenAIApi } from "openai";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// CORS headers to allow requests from your Squarespace domain
const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // or your specific Squarespace domain
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    res.setHeaders(corsHeaders);
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    res.setHeaders(corsHeaders);
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
    res.setHeaders(corsHeaders);
    return res.status(200).json({ action: "reply", message: reply });
  } catch (error) {
    console.error(error);
    res.setHeaders(corsHeaders);
    return res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
}
