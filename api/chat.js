import OpenAI from "openai";
import { google } from "googleapis";
import { DateTime } from "luxon";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Google Calendar setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const CALENDAR_ID = "primary";
const TIMEZONE = "America/Belize";

const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

const systemPrompt = {
  role: "system",
  content: `You are a Tech Johnny support assistant. Collect:
Name, Email, Company, Property, Issue, Phone, Restarted (Yes/No), Session Type.
Ask one question at a time. When complete, call function.`
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

// Get busy times from calendar
async function getBusy(timeMin, timeMax) {
  try {
    const res = await calendar.freebusy.query({
      requestBody: { timeMin, timeMax, items: [{ id: CALENDAR_ID }] }
    });
    return res.data.calendars[CALENDAR_ID].busy || [];
  } catch (err) {
    console.error("Calendar FreeBusy Error:", err);
    return [];
  }
}

// Generate available slots (respects session duration)
function generateSlots(busy, sessionMinutes = 30) {
  const slots = [];
  let now = DateTime.now().setZone(TIMEZONE).plus({ minutes: 30 });
  const end = now.plus({ hours: 24 });

  while (now < end) {
    const slotEnd = now.plus({ minutes: sessionMinutes });

    const isBusy = busy.some(b => {
      const start = DateTime.fromISO(b.start);
      const end = DateTime.fromISO(b.end);
      return now < end && slotEnd > start;
    });

    if (!isBusy && now.hour >= 8 && now.hour <= 18) {
      slots.push(now.toISO());
    }

    now = now.plus({ minutes: 30 });
  }

  return slots;
}

// Main handler
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  console.log("Incoming request body:", req.body);

  try {
    // Handle booking
    if (req.body.action === "book") {
      const { selectedTime, userData } = req.body;
      if (!selectedTime || !userData) {
        return res.json({ action: "reply", message: "Invalid booking data." });
      }

      const start = DateTime.fromISO(selectedTime).setZone(TIMEZONE);
      const end = start.plus({ minutes: durations[userData.session_type] || 30 });

      const event = {
        summary: `${userData.session_type} - ${userData.name}`,
        description: userData.issue_description,
        start: { dateTime: start.toUTC().toISO(), timeZone: TIMEZONE },
        end: { dateTime: end.toUTC().toISO(), timeZone: TIMEZONE },
        attendees: [{ email: userData.email }]
      };

      try {
        const response = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
        return res.json({
          action: "link",
          message: "Booked successfully!",
          url: response.data.htmlLink
        });
      } catch (err) {
        console.error("Calendar Event Insert Error:", err);
        return res.json({ action: "reply", message: "Failed to book event. Try another time." });
      }
    }

    // Chat flow
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
        function_call: "auto"
      });
    } catch (err) {
      console.error("OpenAI Completion Error:", err);
      return res.json({ action: "reply", message: "Error reaching OpenAI. Try again." });
    }

    const msg = completion.choices[0].message;

    // If function call, generate slots
    if (msg.function_call) {
      let args = {};
      try {
        args = JSON.parse(msg.function_call.arguments);
      } catch (err) {
        console.error("Function call args parse error:", err);
      }

      const now = DateTime.now().setZone(TIMEZONE);
      const sessionMinutes = durations[args.session_type] || 30;
      const busy = await getBusy(now.toUTC().toISO(), now.plus({ hours: 24 }).toUTC().toISO());
      const slots = generateSlots(busy, sessionMinutes);

      return res.json({
        action: "slots",
        message: "Choose a time:",
        slots: slots.slice(0, 8),
        userData: args
      });
    }

    // Regular reply
    return res.json({ action: "reply", message: msg.content });

  } catch (err) {
    console.error("Unexpected handler error:", err);
    return res.json({ action: "reply", message: "Something went wrong. Please try again." });
  }
}
