import OpenAI from "openai";
import { DateTime } from "luxon";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ======================= Calendly Configuration =======================
const CALENDLY_API_BASE = "https://api.calendly.com";
const CALENDLY_ACCESS_TOKEN = process.env.CALENDLY_ACCESS_TOKEN;

const eventTypeMap = {
  "5min":  "https://api.calendly.com/event_types/2ca6b53a-d972-4b1a-a433-f26bcee8b5da",
  "20min": "https://api.calendly.com/event_types/CHAGLS4CIMH5D4FU",
  "40min": "https://api.calendly.com/event_types/0b6dc9be-8891-45d8-a220-9b4eeaf9f178",
  "60min": "https://api.calendly.com/event_types/DCFHPX7CIOBZG6JH",
  "nosub": "https://api.calendly.com/event_types/DEPEABECSGGRWQXT",
};

const durations = {
  "5min": 5,
  "20min": 20,
  "40min": 40,
  "60min": 60,
  "nosub": 60,
};

const TIMEZONE = "America/Belize";

// ======================= SuperOps Configuration =======================
const SUPER_OPS_API_URL = "https://api.superops.ai/msp";
const SUPER_OPS_ACCESS_TOKEN = process.env.SUPEROPS_ACCESS_TOKEN;
const ONBOARDING_CLIENT_ID = "YOUR_ACTUAL_CLIENT_ID"; // Replace with your client ID

// ======================= System Prompts =======================
const routerSystemPrompt = {
  role: "system",
  content: `You are a friendly Tech Johnny assistant. The user can either:
1. **Onboard** – set up a new user workstation and collect all necessary environment details.
2. **Support** – open a support ticket and schedule a remote session with a technician.

Please ask the user which one they need: "onboard" or "support". Once they choose, you will continue with the appropriate process. Keep your response short and clear.`
};

const supportSystemPrompt = {
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

const onboardingSystemPrompt = {
  role: "system",
  content: `You are a friendly and thorough Tech Johnny onboarding assistant. Your goal is to collect all necessary workstation and environment details for a new user.

Collect the following required details **one at a time**. Ask for each field individually, waiting for the response before moving to the next.

Required fields:
- primary_work_location (choose: home office, Chicago, or Boston)
- team_member_name
- phone
- system_name
- email
- os_version
- bitlocker_status
- office_license
- pc_azure_local
- connected_printers
- number_of_monitors
- adobe_acrobat
- docking_station_model
- printer_installed
- physical_damage
- cell_phone_number
- tablet_home_monitors
- wireless_keyboard_mouse
- current_isp
- google_workspace
- slack_admin
- microsoft_login
- smart_wifi_admin
- adobe_creative_cloud_admin
- office_wifi_password_ssid
- isp_name
- isp_modem_wifi_network
- pc_connection_type

Once you have collected all fields, call the submit_onboarding_request function with the complete details.`,
};

const supportFunctions = [{
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

const onboardingFunctions = [{
  name: "submit_onboarding_request",
  parameters: {
    type: "object",
    properties: {
      primary_work_location: { type: "string" },
      team_member_name: { type: "string" },
      phone: { type: "string" },
      system_name: { type: "string" },
      email: { type: "string" },
      os_version: { type: "string" },
      bitlocker_status: { type: "string" },
      office_license: { type: "string" },
      pc_azure_local: { type: "string" },
      connected_printers: { type: "string" },
      number_of_monitors: { type: "string" },
      adobe_acrobat: { type: "string" },
      docking_station_model: { type: "string" },
      printer_installed: { type: "string" },
      physical_damage: { type: "string" },
      cell_phone_number: { type: "string" },
      tablet_home_monitors: { type: "string" },
      wireless_keyboard_mouse: { type: "string" },
      current_isp: { type: "string" },
      google_workspace: { type: "string" },
      slack_admin: { type: "string" },
      microsoft_login: { type: "string" },
      smart_wifi_admin: { type: "string" },
      adobe_creative_cloud_admin: { type: "string" },
      office_wifi_password_ssid: { type: "string" },
      isp_name: { type: "string" },
      isp_modem_wifi_network: { type: "string" },
      pc_connection_type: { type: "string" }
    },
    required: [
      "primary_work_location", "team_member_name", "phone", "system_name", "email",
      "os_version", "bitlocker_status", "office_license", "pc_azure_local",
      "connected_printers", "number_of_monitors", "adobe_acrobat", "docking_station_model",
      "printer_installed", "physical_damage", "cell_phone_number", "tablet_home_monitors",
      "wireless_keyboard_mouse", "current_isp", "google_workspace", "slack_admin",
      "microsoft_login", "smart_wifi_admin", "adobe_creative_cloud_admin",
      "office_wifi_password_ssid", "isp_name", "isp_modem_wifi_network", "pc_connection_type"
    ]
  }
}];

// ======================= Calendly Helper Functions =======================
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
    if (company) answers.push({ question: "Company Name", answer: company });
    if (property) answers.push({ question: "Property/Location Name", answer: property });
    if (issue_description) answers.push({ question: "Description of issue", answer: issue_description });
    if (phone_number) answers.push({ question: "Phone Number you will be calling us from at your session time?", answer: phone_number });
    if (restarted_computer) {
      const restartOption = restarted_computer.toLowerCase() === "yes"
        ? "Yes, i am ready for Tech Johhny"
        : "No, i will restart it NOW before i call Tech Johnny";
      answers.push({ question: "Have you restarted your computer today?", answer: restartOption });
    }
  }
  return answers;
}

async function bookCalendlyEvent(eventTypeUri, startTime, invitee, customAnswers, sessionType) {
  const questionsAndAnswers = customAnswers.map((qa, index) => ({
    question: qa.question,
    answer: qa.answer,
    position: index,
  }));

  let location = null;
  if (sessionType === "nosub") {
    location = { kind: "inbound_call", phone_number: "+1 248-905-1529" };
  } else {
    location = { kind: "google_conference" };
  }

  const payload = {
    event_type: eventTypeUri,
    start_time: startTime,
    invitee: {
      name: invitee.name,
      email: invitee.email,
      timezone: TIMEZONE,
    },
    questions_and_answers: questionsAndAnswers,
    ...(location && { location }),
  };

  if (invitee.phone) {
    let phone = invitee.phone.trim();
    const digitsOnly = phone.replace(/\D/g, '');
    if (phone.startsWith('+')) {
      payload.invitee.text_reminder_number = phone;
    } else if (digitsOnly.length === 10) {
      payload.invitee.text_reminder_number = `+1${digitsOnly}`;
    } else if (digitsOnly.length === 7) {
      payload.invitee.text_reminder_number = `+501${digitsOnly}`;
    } else {
      console.warn(`Could not format phone number: ${phone} – omitting text_reminder_number`);
    }
  }

  console.log("📤 Calendly booking payload:", JSON.stringify(payload, null, 2));

  const response = await fetch(`${CALENDLY_API_BASE}/invitees`, {
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

// ======================= SuperOps Helper Function =======================
async function createSuperOpsTicket(onboardingData) {
  let description = "Onboarding Request Details:\n\n";
  for (const [key, value] of Object.entries(onboardingData)) {
    if (value && value !== "null" && value !== "undefined") {
      description += `${key.replace(/_/g, ' ').toUpperCase()}: ${value}\n`;
    }
  }

  const mutation = `
    mutation CreateTicket($input: CreateTicketInput!) {
      createTicket(input: $input) {
        ticketId
        displayId
        subject
        status
      }
    }
  `;

  const variables = {
    input: {
      subject: `Onboarding Request - ${onboardingData.team_member_name || "New User"}`,
      description: description,
      source: "FORM",
      status: "New",
      client: { accountId: ONBOARDING_CLIENT_ID },
    }
  };

  const response = await fetch(SUPER_OPS_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPER_OPS_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ query: mutation, variables }),
  });

  const result = await response.json();
  if (result.errors) {
    console.error("SuperOps mutation errors:", result.errors);
    throw new Error(result.errors[0].message);
  }
  return result.data.createTicket;
}

// ======================= Main Next.js API Handler =======================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ action: "reply", message: "Invalid request. Please send a valid JSON body." });
  }

  console.log("Incoming request body:", req.body);

  // Determine flow: if an intent is already set, use it; otherwise check conversation history
  let { intent, messages } = req.body;
  if (!intent && messages && messages.length > 0) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const lower = lastUserMsg.content.toLowerCase();
      if (lower === "onboard" || lower === "support") {
        intent = lower;
      }
    }
  }

  // If we still don't have an intent, use the router to ask
  if (!intent) {
    try {
      if (!messages || messages.length === 0) {
        return res.json({
          action: "reply",
          message: "Hello! I'm Tech Johnny's assistant. Would you like to **onboard** a new user (collect workstation details) or **open a support ticket** (schedule a session with a technician)? Please reply with 'onboard' or 'support'."
        });
      } else {
        const completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [routerSystemPrompt, ...messages],
          // No functions or function_call parameters
        });
        const reply = completion.choices[0].message.content;
        return res.json({ action: "reply", message: reply });
      }
    } catch (err) {
      console.error("Router error:", err);
      return res.json({ action: "reply", message: "Sorry, I'm having trouble. Please try again." });
    }
  }

  // ======================= ONBOARDING FLOW =======================
  if (intent === "onboard") {
    try {
      if (!messages || !Array.isArray(messages)) {
        return res.json({ action: "reply", message: "Invalid messages format." });
      }

      let completion;
      try {
        completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [onboardingSystemPrompt, ...messages],
          functions: onboardingFunctions,
          function_call: "auto",
        });
      } catch (err) {
        console.error("OpenAI Completion Error:", err);
        return res.json({ action: "reply", message: "Error reaching OpenAI. Try again." });
      }

      const msg = completion.choices[0].message;

      if (msg.function_call && msg.function_call.name === "submit_onboarding_request") {
        let args = {};
        try {
          args = JSON.parse(msg.function_call.arguments);
        } catch (err) {
          console.error("Function call args parse error:", err);
        }

        try {
          const ticket = await createSuperOpsTicket(args);
          console.log("✅ Ticket created:", ticket);
          return res.json({
            action: "reply",
            message: `Thank you! An onboarding ticket (${ticket.displayId}) has been created. Our team will review it and reach out if needed.`,
          });
        } catch (err) {
          console.error("Failed to create SuperOps ticket:", err);
          return res.json({
            action: "reply",
            message: "We received your information, but there was an issue creating the ticket. Our team has been notified. Please contact support if you don't hear back soon.",
          });
        }
      }

      return res.json({ action: "reply", message: msg.content });
    } catch (err) {
      console.error("Unexpected onboarding error:", err);
      return res.json({ action: "reply", message: "Something went wrong during onboarding. Please try again." });
    }
  }

  // ======================= SUPPORT FLOW =======================
  try {
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

      let startTimeUtc = selectedTime;
      if (!selectedTime.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[-+]\d{2}:\d{2})/)) {
        const local = DateTime.fromFormat(selectedTime, "M/d/yyyy, h:mm:ss a", { zone: TIMEZONE });
        if (local.isValid) {
          startTimeUtc = local.toUTC().toISO();
          console.log(`Converted local time "${selectedTime}" to UTC: ${startTimeUtc}`);
        } else {
          console.error(`Invalid time format: ${selectedTime}`);
          return res.json({ action: "reply", message: "Invalid time format. Please select a time again." });
        }
      }

      const invitee = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone_number,
      };

      let customAnswers = buildCustomAnswers(sessionType, userData);

      if (fileLink && customAnswers.some(a => a.question === "Description of issue" || a.question === "Please share anything that will help prepare for our meeting.")) {
        const descAnswer = customAnswers.find(a => a.question === "Description of issue" || a.question === "Please share anything that will help prepare for our meeting.");
        if (descAnswer) {
          descAnswer.answer += `\n\nAttached image: ${fileLink}`;
        }
      }

      try {
        const booking = await bookCalendlyEvent(eventTypeUri, startTimeUtc, invitee, customAnswers, sessionType);
        const inviteeUri = booking.resource?.uri;
        return res.json({
          action: "link",
          message: "Booked successfully! You will receive a confirmation email and SMS shortly.",
          url: inviteeUri,
        });
      } catch (err) {
        console.error("Calendly booking error:", err);
        return res.json({ action: "reply", message: "Booking failed. Please try another time or contact support." });
      }
    }

    if (!messages || !Array.isArray(messages)) {
      return res.json({ action: "reply", message: "Invalid messages format." });
    }

    let completion;
    try {
      completion = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [supportSystemPrompt, ...messages],
        functions: supportFunctions,
        function_call: "auto",
      });
    } catch (err) {
      console.error("OpenAI Completion Error:", err);
      return res.json({ action: "reply", message: "Error reaching OpenAI. Try again." });
    }

    const msg = completion.choices[0].message;

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

      const now = DateTime.now().setZone(TIMEZONE);
      const startTime = now.plus({ minutes: 1 });
      const endTime = now.plus({ days: 7 });
      const slots = await getCalendlySlots(eventTypeUri, startTime, endTime);

      if (!slots || slots.length === 0) {
        return res.json({
          action: "reply",
          message: "No available slots in the next 7 days for that session type. Please try another session type or try again later.",
        });
      }

      return res.json({
        action: "slots",
        message: "Choose a time:",
        slots: slots.slice(0, 8),
        userData: args,
      });
    }

    return res.json({ action: "reply", message: msg.content });
  } catch (err) {
    console.error("Unexpected support flow error:", err);
    return res.json({ action: "reply", message: "Something went wrong. Please try again." });
  }
}
