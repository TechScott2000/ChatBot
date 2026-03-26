// api/chat.js
import { Configuration, OpenAIApi } from "openai";
import { google } from "googleapis";
import { DateTime } from "luxon";

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// ===== Google Calendar OAuth Setup =====
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const CALENDAR_ID = "primary";
const DEFAULT_TIMEZONE = "America/Chicago";

const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};
// =================================

// OpenAI function definition
const functions = [
  {
    name: "submit_support_request",
    description: "Submit a support request with all required details for scheduling",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Customer's full name" },
        email: { type: "string", description: "Customer's email address" },
        company: { type: "string", description: "Company name" },
        property: { type: "string", description: "Property or location name" },
        issue_description: { type: "string", description: "Detailed description of the issue" },
        phone_number: { type: "string", description: "Phone number the customer will call from" },
        restarted_computer: { type: "string", enum: ["Yes", "No"], description: "Whether they have restarted their computer today" },
        session_type: { type: "string", enum: ["5min", "20min", "40min", "60min", "nosub"], description: "Type of session they want" }
      },
      required: ["name", "email", "company", "property", "issue_description", "phone_number", "restarted_computer", "session_type"]
    }
  }
];

// System prompt
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

Ask one question at a time, be conversational, and confirm details when needed. Once you have all information, call the submit_support_request function.`
};

export default async function handler(req, res) {
  // CORS headers
  const setCors = (r) => {
    r.setHeader("Access-Control-Allow-Origin", "*");
    r.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    r.setHeader("Access-Control-Allow-Headers", "Content-Type");
  };
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { messages, timezone } = req.body;
  const userTimezone = timezone || DEFAULT_TIMEZONE;

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [systemPrompt, ...messages],
      functions: functions,
      function_call: "auto",
      temperature: 0.7,
    });

    const responseMessage = completion.data.choices[0].message;

    if (responseMessage.function_call) {
      const functionName = responseMessage.function_call.name;
      if (functionName === "submit_support_request") {
        const args = JSON.parse(responseMessage.function_call.arguments);

        // Set default start time: tomorrow at 10:00 AM in the user's timezone
        const startDateTime = DateTime.now()
          .setZone(userTimezone)
          .plus({ days: 1 })
          .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });

        const durationMinutes = durations[args.session_type] || 30;
        const endDateTime = startDateTime.plus({ minutes: durationMinutes });

        // Convert to UTC ISO strings for Google Calendar
        const startIso = startDateTime.toUTC().toISO();
        const endIso = endDateTime.toUTC().toISO();

        const event = {
          summary: `${args.session_type.toUpperCase()} - ${args.name}`,
          description: `Company: ${args.company}\nProperty: ${args.property}\nIssue: ${args.issue_description}\nPhone: ${args.phone_number}\nRestarted: ${args.restarted_computer}`,
          start: { dateTime: startIso, timeZone: userTimezone },
          end: { dateTime: endIso, timeZone: userTimezone },
          attendees: [{ email: args.email }],
        };

        const response = await calendar.events.insert({
          calendarId: CALENDAR_ID,
          resource: event,
          sendUpdates: "all",
        });

        const eventLink = response.data.htmlLink;

        // Display time in user's local format
        const localTimeString = startDateTime.toLocaleString(DateTime.DATETIME_MED);

        return res.status(200).json({
          action: "link",
          message: `Your session has been scheduled for ${localTimeString} (your local time). Click the link to add it to your calendar:`,
          url: eventLink
        });
      }
    }

    // If no function call, just reply with text
    return res.status(200).json({
      action: "reply",
      message: responseMessage.content
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
}
