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
const WORK_HOURS = { start: 9, end: 17 };
const SLOT_INTERVAL = 30;

const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

// Simple in‑memory session store
const pendingDetails = new Map();

// ---- Helper: parse natural language to DateTime ----
function parseDateTime(text, referenceZone = DEFAULT_TIMEZONE) {
  const lower = text.toLowerCase();
  const now = DateTime.now().setZone(referenceZone);
  
  // "tomorrow at X:XXpm/am"
  let match = lower.match(/(tomorrow|today)\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (match) {
    let day = match[1] === 'tomorrow' ? now.plus({ days: 1 }) : now;
    let hour = parseInt(match[2]);
    let minute = match[3] ? parseInt(match[3]) : 0;
    let period = match[4];
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    return day.set({ hour, minute, second: 0 });
  }
  
  // "March 27 at 10am"
  match = lower.match(/(\w+\s+\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (match) {
    let dateStr = match[1];
    let hour = parseInt(match[2]);
    let minute = match[3] ? parseInt(match[3]) : 0;
    let period = match[4];
    if (period === 'pm' && hour < 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    let dt = DateTime.fromFormat(dateStr, 'MMMM d', { zone: referenceZone });
    if (dt.isValid) return dt.set({ hour, minute, second: 0 });
  }
  
  // "2026-03-27 10:00"
  match = lower.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2})(?::(\d{2}))?/);
  if (match) {
    let datePart = match[1];
    let hour = parseInt(match[2]);
    let minute = match[3] ? parseInt(match[3]) : 0;
    let dt = DateTime.fromISO(datePart, { zone: referenceZone });
    if (dt.isValid) return dt.set({ hour, minute, second: 0 });
  }
  
  return null;
}

// ---- Helper: get free slots for a given day ----
async function getFreeSlots(day, durationMinutes, timezone) {
  const startOfDay = day.startOf('day');
  const endOfDay = day.endOf('day');
  
  // Generate candidate slots within work hours
  const slots = [];
  let cursor = startOfDay.set({ hour: WORK_HOURS.start, minute: 0 });
  const endWork = startOfDay.set({ hour: WORK_HOURS.end, minute: 0 });
  while (cursor < endWork) {
    const slotEnd = cursor.plus({ minutes: durationMinutes });
    if (slotEnd <= endWork) {
      slots.push(cursor);
    }
    cursor = cursor.plus({ minutes: SLOT_INTERVAL });
  }
  
  if (slots.length === 0) return [];
  
  // Query busy times
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: startOfDay.toISO(),
      timeMax: endOfDay.toISO(),
      items: [{ id: CALENDAR_ID }],
      timeZone: timezone
    }
  });
  const busy = response.data.calendars[CALENDAR_ID].busy || [];
  
  // Filter out busy slots
  const freeSlots = slots.filter(slot => {
    const slotStart = slot;
    const slotEnd = slot.plus({ minutes: durationMinutes });
    return !busy.some(b => {
      const busyStart = DateTime.fromISO(b.start);
      const busyEnd = DateTime.fromISO(b.end);
      return !(slotEnd <= busyStart || slotStart >= busyEnd);
    });
  });
  
  return freeSlots;
}

// ---- Main handler ----
export default async function handler(req, res) {
  const setCors = (r) => {
    r.setHeader("Access-Control-Allow-Origin", "*");
    r.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    r.setHeader("Access-Control-Allow-Headers", "Content-Type");
  };
  setCors(res);
  
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  
  const { messages, timezone } = req.body;
  const userTimezone = timezone || DEFAULT_TIMEZONE;
  
  // Simple session ID based on first user message
  const sessionId = messages.length > 0 && messages[0].role === 'user' ? messages[0].content.slice(0, 100) : 'default';
  
  // Check if we have pending details for this session
  if (pendingDetails.has(sessionId)) {
    const details = pendingDetails.get(sessionId);
    const lastMessage = messages[messages.length - 1];
    const timeText = lastMessage.content;
    
    const duration = durations[details.session_type] || 30;
    let requestedTime = parseDateTime(timeText, userTimezone);
    if (!requestedTime) {
      return res.status(200).json({
        action: "reply",
        message: "Sorry, I couldn't understand the time. Please use a format like 'tomorrow at 2pm' or 'March 27 at 10:00 AM'."
      });
    }
    
    // Check availability
    const freeSlots = await getFreeSlots(requestedTime.startOf('day'), duration, userTimezone);
    const isFree = freeSlots.some(slot => slot.equals(requestedTime));
    
    if (isFree) {
      // Create event
      const startDateTime = requestedTime;
      const endDateTime = startDateTime.plus({ minutes: duration });
      const event = {
        summary: `${details.session_type.toUpperCase()} - ${details.name}`,
        description: `Company: ${details.company}\nProperty: ${details.property}\nIssue: ${details.issue_description}\nPhone: ${details.phone_number}\nRestarted: ${details.restarted_computer}`,
        start: { dateTime: startDateTime.toISO(), timeZone: userTimezone },
        end: { dateTime: endDateTime.toISO(), timeZone: userTimezone },
        attendees: [{ email: details.email }],
      };
      
      const response = await calendar.events.insert({
        calendarId: CALENDAR_ID,
        resource: event,
        sendUpdates: "all",
      });
      
      const eventLink = response.data.htmlLink;
      const localTimeString = startDateTime.toLocaleString(DateTime.DATETIME_MED);
      
      pendingDetails.delete(sessionId);
      return res.status(200).json({
        action: "link",
        message: `Your session has been scheduled for ${localTimeString}. Click the link to add it to your calendar:`,
        url: eventLink
      });
    } else {
      const alternativeSlots = freeSlots.slice(0, 5);
      if (alternativeSlots.length === 0) {
        pendingDetails.delete(sessionId);
        return res.status(200).json({
          action: "reply",
          message: "Sorry, there are no available slots on that day. Please try a different day."
        });
      }
      const slotList = alternativeSlots.map(slot => 
        slot.toLocaleString(DateTime.TIME_SIMPLE)
      ).join(", ");
      return res.status(200).json({
        action: "reply",
        message: `That time is not available. The following times are free on the same day: ${slotList}. Please choose one (e.g., '${alternativeSlots[0].toLocaleString(DateTime.TIME_SIMPLE)}')`
      });
    }
  }
  
  // No pending details – use OpenAI to collect details
  const systemPrompt = {
    role: "system",
    content: `You are a friendly support assistant for Tech Johnny. Gather the following information from the customer:
- Name
- Email
- Company Name
- Property/Location Name
- Detailed description of the issue
- Phone number they will call from
- Whether they have restarted their computer today (Yes/No)
- Which session type they prefer: 5min, 20min, 40min, 60min, or nosub

Ask one question at a time. Once you have all these details, call the submit_support_request function with all the information (do NOT include datetime). After calling the function, do not ask for time; the system will handle that.`
  };
  
  const functions = [
    {
      name: "submit_support_request",
      description: "Submit a support request with all required details (no time yet).",
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
  
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-4o-mini",
      messages: [systemPrompt, ...messages],
      functions: functions,
      function_call: "auto",
      temperature: 0.7,
    });
    
    const responseMessage = completion.data.choices[0].message;
    
    if (responseMessage.function_call && responseMessage.function_call.name === "submit_support_request") {
      const args = JSON.parse(responseMessage.function_call.arguments);
      pendingDetails.set(sessionId, args);
      return res.status(200).json({
        action: "reply",
        message: "Thank you! Could you please let me know the date and time you would like to schedule the session? For example, 'tomorrow at 2pm' or 'March 27 at 10am.'"
      });
    }
    
    return res.status(200).json({
      action: "reply",
      message: responseMessage.content
    });
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
}
