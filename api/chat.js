import OpenAI from "openai";
import { google } from "googleapis";
import { DateTime } from "luxon";

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================= GOOGLE CALENDAR =================
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI // ✅ use your own in prod
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const CALENDAR_ID = "primary";
const DEFAULT_TIMEZONE = "America/New_York"; // ✅ EST

// ================= SESSION DURATIONS =================
const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

// ================= FUNCTIONS =================
const tools = [
  {
    type: "function",
    function: {
      name: "get_available_slots",
      description: "Get available time slots for scheduling",
      parameters: {
        type: "object",
        properties: {
          session_type: {
            type: "string",
            enum: ["5min", "20min", "40min", "60min", "nosub"]
          }
        },
        required: ["session_type"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Book the support session",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
          property: { type: "string" },
          issue_description: { type: "string" },
          phone_number: { type: "string" },
          restarted_computer: { type: "string", enum: ["Yes", "No"] },
          session_type: { type: "string" },
          selected_time: { type: "string", description: "ISO datetime" }
        },
        required: [
          "name","email","company","property",
          "issue_description","phone_number",
          "restarted_computer","session_type","selected_time"
        ]
      }
    }
  }
];

// ================= SYSTEM PROMPT =================
const systemPrompt = {
  role: "system",
  content: `
You are a support assistant for Tech Johnny.

Flow:
1. Collect ALL required info.
2. Ask for session type.
3. Call get_available_slots.
4. Show user options.
5. After user selects time → call book_appointment.

Rules:
- Ask ONE question at a time
- Be concise
- When all info is collected → move forward immediately
`
};

// ================= HELPER: GET FREE SLOTS =================
async function getAvailableSlots(sessionType, timezone) {
  const duration = durations[sessionType];
  const now = DateTime.now().setZone(timezone);

  const startOfDay = now.plus({ days: 1 }).startOf("day").set({ hour: 9 });
  const endOfDay = startOfDay.set({ hour: 17 });

  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toUTC().toISO(),
      timeMax: endOfDay.toUTC().toISO(),
      items: [{ id: CALENDAR_ID }]
    }
  });

  const busy = response.data.calendars[CALENDAR_ID].busy;

  let slots = [];
  let current = startOfDay;

  while (current.plus({ minutes: duration }) <= endOfDay) {
    const slotEnd = current.plus({ minutes: duration });

    const conflict = busy.some(b =>
      current < DateTime.fromISO(b.end) &&
      slotEnd > DateTime.fromISO(b.start)
    );

    if (!conflict) {
      slots.push(current.toISO());
    }

    current = current.plus({ minutes: 30 }); // 30-min intervals
  }

  return slots.slice(0, 5); // limit options
}

// ================= HANDLER =================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  const { messages, timezone } = req.body;
  const userTimezone = timezone || DEFAULT_TIMEZONE;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemPrompt, ...messages],
      tools,
      tool_choice: "auto",
      temperature: 0.7,
    });

    const msg = completion.choices[0].message;

    // ================= TOOL CALL =================
    if (msg.tool_calls) {
      const toolCall = msg.tool_calls[0];
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);

      // ===== GET AVAILABLE SLOTS =====
      if (name === "get_available_slots") {
        const slots = await getAvailableSlots(args.session_type, userTimezone);

        const readable = slots.map(s =>
          DateTime.fromISO(s).setZone(userTimezone).toLocaleString(DateTime.DATETIME_MED)
        );

        return res.json({
          action: "reply",
          message: `Here are available times:\n\n${readable.join("\n")}\n\nWhich one works for you?`,
          slots
        });
      }

      // ===== BOOK APPOINTMENT =====
      if (name === "book_appointment") {
        const start = DateTime.fromISO(args.selected_time).setZone(userTimezone);
        const end = start.plus({ minutes: durations[args.session_type] });

        const event = {
          summary: `${args.session_type} - ${args.name}`,
          description: `
Company: ${args.company}
Property: ${args.property}
Issue: ${args.issue_description}
Phone: ${args.phone_number}
Restarted: ${args.restarted_computer}
          `,
          start: { dateTime: start.toUTC().toISO(), timeZone: userTimezone },
          end: { dateTime: end.toUTC().toISO(), timeZone: userTimezone },
          attendees: [{ email: args.email }]
        };

        const response = await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: event,
          sendUpdates: "all",
        });

        return res.json({
          action: "link",
          message: `Booked for ${start.toLocaleString(DateTime.DATETIME_MED)}`,
          url: response.data.htmlLink
        });
      }
    }

    // ================= NORMAL CHAT =================
    return res.json({
      action: "reply",
      message: msg.content
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
