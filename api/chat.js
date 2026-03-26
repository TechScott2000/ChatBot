// ================= IMPORTS =================
const OpenAI = require("openai");
const { google } = require("googleapis");
const { DateTime } = require("luxon");

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================= GOOGLE CALENDAR =================
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI // ⚠️ set this in env
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({
  version: "v3",
  auth: oauth2Client,
});

const CALENDAR_ID = "primary";
const DEFAULT_TIMEZONE = "America/New_York"; // ✅ EST

// ================= SESSION TYPES =================
const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

// ================= OPENAI TOOLS =================
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
            enum: ["5min", "20min", "40min", "60min", "nosub"],
          },
        },
        required: ["session_type"],
      },
    },
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
          selected_time: { type: "string" },
        },
        required: [
          "name",
          "email",
          "company",
          "property",
          "issue_description",
          "phone_number",
          "restarted_computer",
          "session_type",
          "selected_time",
        ],
      },
    },
  },
];

// ================= SYSTEM PROMPT =================
const systemPrompt = {
  role: "system",
  content: `
You are a Tech Johnny support assistant.

FLOW:
1. Collect all required info:
   - name, email, company, property, issue_description, phone_number, restarted_computer
2. Ask for session type
3. Call get_available_slots
4. Show times to user
5. When user selects → call book_appointment

RULES:
- Ask ONE question at a time
- Be concise
- Once info is complete → move forward immediately
`,
};

// ================= GET AVAILABLE SLOTS =================
async function getAvailableSlots(sessionType, timezone) {
  const duration = durations[sessionType];
  const now = DateTime.now().setZone(timezone);

  const start = now.plus({ days: 1 }).set({ hour: 9, minute: 0 });
  const end = start.set({ hour: 17 });

  const fb = await calendar.freebusy.query({
    requestBody: {
      timeMin: start.toUTC().toISO(),
      timeMax: end.toUTC().toISO(),
      items: [{ id: CALENDAR_ID }],
    },
  });

  const busy = fb.data.calendars[CALENDAR_ID].busy;

  let slots = [];
  let current = start;

  while (current.plus({ minutes: duration }) <= end) {
    const slotEnd = current.plus({ minutes: duration });

    const conflict = busy.some((b) => {
      const bStart = DateTime.fromISO(b.start);
      const bEnd = DateTime.fromISO(b.end);
      return current < bEnd && slotEnd > bStart;
    });

    if (!conflict) {
      slots.push(current.toISO());
    }

    current = current.plus({ minutes: 30 });
  }

  return slots.slice(0, 5);
}

// ================= HANDLER =================
module.exports = async function handler(req, res) {
  // ===== CORS =====
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

    // ===== TOOL CALL HANDLING =====
    if (msg.tool_calls) {
      const toolCall = msg.tool_calls[0];
      const functionName = toolCall.function.name;

      let args;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch (err) {
        return res.json({
          action: "reply",
          message: "I had trouble reading that. Can you confirm your details?",
        });
      }

      // ===== GET SLOTS =====
      if (functionName === "get_available_slots") {
        const slots = await getAvailableSlots(
          args.session_type,
          userTimezone
        );

        const readable = slots.map((s) =>
          DateTime.fromISO(s)
            .setZone(userTimezone)
            .toLocaleString(DateTime.DATETIME_MED)
        );

        return res.json({
          action: "reply",
          message:
            "Here are available times:\n\n" +
            readable.join("\n") +
            "\n\nWhich one works for you?",
          slots,
        });
      }

      // ===== BOOK =====
      if (functionName === "book_appointment") {
        const start = DateTime.fromISO(args.selected_time).setZone(
          userTimezone
        );
        const end = start.plus({
          minutes: durations[args.session_type],
        });

        const event = {
          summary: `${args.session_type} - ${args.name}`,
          description: `
Company: ${args.company}
Property: ${args.property}
Issue: ${args.issue_description}
Phone: ${args.phone_number}
Restarted: ${args.restarted_computer}
          `,
          start: {
            dateTime: start.toUTC().toISO(),
            timeZone: userTimezone,
          },
          end: {
            dateTime: end.toUTC().toISO(),
            timeZone: userTimezone,
          },
          attendees: [{ email: args.email }],
        };

        const response = await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: event,
          sendUpdates: "all",
        });

        return res.json({
          action: "link",
          message:
            "Booked for " +
            start.toLocaleString(DateTime.DATETIME_MED),
          url: response.data.htmlLink,
        });
      }
    }

    // ===== NORMAL RESPONSE =====
    return res.json({
      action: "reply",
      message: msg.content,
    });
  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({
      error: "Something went wrong",
    });
  }
};
