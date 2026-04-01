import OpenAI from "openai";
import { DateTime } from "luxon";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ======================= Calendly Configuration =======================
const CALENDLY_API_BASE = "https://api.calendly.com";
const CALENDLY_ACCESS_TOKEN = process.env.CALENDLY_ACCESS_TOKEN;

// Map session types to Calendly event type URIs
const eventTypeMap = {
  "5min":  "https://api.calendly.com/event_types/2ca6b53a-d972-4b1a-a433-f26bcee8b5da",
  "20min": "https://api.calendly.com/event_types/CHAGLS4CIMH5D4FU",
  "40min": "https://api.calendly.com/event_types/0b6dc9be-8891-45d8-a220-9b4eeaf9f178",
  "60min": "https://api.calendly.com/event_types/DCFHPX7CIOBZG6JH",
  "nosub": "https://api.calendly.com/event_types/DEPEABECSGGRWQXT",
};

// Duration mapping (for reference only)
const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

const TIMEZONE = "America/Belize";

// ======================= System Prompt =======================
const systemPrompt = {
  role: "system",
  content: `You are a friendly and thorough Tech Johnny support assistant. Your goal is to gather comprehensive information to help resolve the user's issue and schedule a support session if needed.

Collect the following required details:
- Name
- Email
- Company
- Property (location or property name)
- Issue description (ask once; request a concise summary: what's happening, any error messages, steps already taken)
- Phone number
- Restarted computer (Yes/No; if no, encourage them to restart before the call)
- Session type (choose from: 5min, 20min, 40min, 60min, nosub). Explain the options if needed.

Ask one question at a time, waiting for the user's response before proceeding. Be conversational and helpful.

For the issue description, ask **only one question** (e.g., “Please describe the issue in a few sentences – include what’s happening, any error messages, and what you’ve already tried.”). Do not ask for more details after that.

Once you have collected all required fields, call the submit_support_request function with the details. Make sure the issue_description field contains all the information you gathered.`,
};

const functions = [{
  name: "submit_support_request",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      company: { type: "string" },
      property: { type: "string" },
      issue_description: { type: "string" },
      phone_number: { type: "string" },
      restarted_computer: { type: "string" },
      session_type: { type: "string" }
    },
    required: ["name","email","company","property","issue_description","phone_number","restarted_computer","session_type"]
  }
}];

// ======================= Calendly Helper Functions =======================

/**
 * Fetch available slots from Calendly for a given event type.
 * @param {string} eventTypeUri - Full URI of the Calendly event type
 * @param {DateTime} startTime - Start of time window (local)
 * @param {DateTime} endTime - End of time window
 * @returns {Promise<string[]|null>} Array of ISO start times (UTC) or null on error
 */
async function getCalendlySlots(eventTypeUri, startTime, endTime) {
  try {
    const startIso = startTime.toUTC().toISO();
    const endIso = endTime.toUTC().toISO();
    const url = `${CALENDLY_API_BASE}/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${startIso}&end_time=${endIso}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Calendly availability error:", response.status, errorText);
      return null;
    }
    const data = await response.json();
    return data.collection.map(slot => slot.start_time);
  } catch (err) {
    console.error("Calendly availability fetch exception:", err);
    return null;
  }
}

/**
 * Build the custom answers array based on the selected event type and collected data.
 */
function buildCustomAnswers(sessionType, userData) {
  const answers = [];
  const { company, property, issue_description, phone_number, restarted_computer } = userData;

  if (sessionType === "nosub") {
    if (issue_description) {
      answers.push({
        question: "Please share anything that will help prepare for our meeting.",
        answer: issue_description,
      });
    }
    if (phone_number) {
      answers.push({
        question: "Phone Number you will be calling Tech Johnny from at your session time?",
        answer: phone_number,
      });
    }
  } else {
    if (company) {
      answers.push({ question: "Company Name", answer: company });
    }
    if (property) {
      answers.push({ question: "Property/Location Name", answer: property });
    }
    if (issue_description) {
      answers.push({ question: "Description of issue", answer: issue_description });
    }
    if (phone_number) {
      answers.push({ question: "Phone Number you will be calling us from at your session time?", answer: phone_number });
    }
    if (restarted_computer) {
      const restartOption = restarted_computer.toLowerCase() === "yes"
        ? "Yes, i am ready for Tech Johhny"
        : "No, i will restart it NOW before i call Tech Johnny";
      answers.push({ question: "Have you restarted your computer today?", answer: restartOption });
    }
  }
  return answers;
}

/**
 * Create a scheduled event in Calendly.
 */
async function bookCalendlyEvent(eventTypeUri, startTime, invitee, customAnswers) {
  const payload = {
    event_type: eventTypeUri,
    start_time: startTime,
    invitee: {
      name: invitee.name,
      email: invitee.email,
      ...(invitee.phone && { phone: invitee.phone }),
    },
    questions_and_answers: customAnswers,
  };

  const response = await fetch(`${CALENDLY_API_BASE}/scheduled_events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALENDLY_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Calendly booking failed (${response.status}): ${errorBody}`);
  }
  return response.json();
}

// ======================= Main Next.js API Handler =======================
export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ action: "reply", message: "Invalid request. Please send a valid JSON body." });
  }

  console.log("Incoming request body:", req.body);

  try {
    // ----------------------- BOOKING ACTION -----------------------
    if (req.body.action === "book") {
      const { selectedTime, userData, fileLink } = req.body;
      if (!selectedTime || !userData) {
        return res.json({ action: "reply", message: "Invalid booking data." });
      }

      const sessionType = userData.session_type;
      const eventTypeUri = eventTypeMap[sessionType];
      if (!eventTypeUri) {
        return res.json({ action: "reply", message: "Invalid session type." });
      }

      const invitee = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone_number,
      };

      let customAnswers = buildCustomAnswers(sessionType, userData);

      // Append file link if present
      if (fileLink && customAnswers.some(a => a.question === "Description of issue" || a.question === "Please share anything that will help prepare for our meeting.")) {
        const descAnswer = customAnswers.find(a => a.question === "Description of issue" || a.question === "Please share anything that will help prepare for our meeting.");
        if (descAnswer) {
          descAnswer.answer += `\n\nAttached image: ${fileLink}`;
        }
      }

      try {
        const booking = await bookCalendlyEvent(eventTypeUri, selectedTime, invitee, customAnswers);
        return res.json({
          action: "link",
          message: "Booked successfully! You will receive a confirmation email and SMS shortly.",
          url: booking.resource.uri,
        });
      } catch (err) {
        console.error("Calendly booking error:", err);
        return res.json({ action: "reply", message: "Booking failed. Please try another time or contact support." });
      }
    }

    // ----------------------- CHAT FLOW -----------------------
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.json({ action: "reply", message: "Invalid messages format." });
    }

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [systemPrompt, ...messages],
        functions,
        function_call: "auto",
      });
    } catch (err) {
      console.error("OpenAI Completion Error:", err);
      return res.json({ action: "reply", message: "Error reaching OpenAI. Try again." });
    }

    const msg = completion.choices[0].message;

    // If the AI wants to submit the request (function call)
    if (msg.function_call) {
      let args = {};
      try {
        args = JSON.parse(msg.function_call.arguments);
      } catch (err) {
        console.error("Function call args parse error:", err);
      }

      const sessionType = args.session_type;
      const eventTypeUri = eventTypeMap[sessionType];
      if (!eventTypeUri) {
        return res.json({ action: "reply", message: "Invalid session type. Please choose from: 5min, 20min, 40min, 60min, nosub." });
      }

      // Get available slots for the next 7 days (starting now)
      const now = DateTime.now().setZone(TIMEZONE);
      const endTime = now.plus({ days: 7 });
      const slots = await getCalendlySlots(eventTypeUri, now, endTime);

      if (!slots || slots.length === 0) {
        return res.json({
          action: "reply",
          message: "No available slots in the next 7 days for that session type. Please try another session type or try again later.",
        });
      }

      // Return slots to the frontend
      return res.json({
        action: "slots",
        message: "Choose a time:",
        slots: slots.slice(0, 8),
        userData: args,
      });
    }

    // Regular reply (no function call)
    return res.json({ action: "reply", message: msg.content });

  } catch (err) {
    console.error("Unexpected handler error:", err);
    return res.json({ action: "reply", message: "Something went wrong. Please try again." });
  }
}
