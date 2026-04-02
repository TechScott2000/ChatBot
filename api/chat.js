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
// Router prompt – used when no flow has been chosen yet
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

// ======================= Helper Functions (unchanged) =======================
async function getCalendlySlots(eventTypeUri, startTime, endTime) {
  // ... (same as before)
}

function buildCustomAnswers(sessionType, userData) {
  // ... (same as before)
}

async function bookCalendlyEvent(eventTypeUri, startTime, invitee, customAnswers, sessionType) {
  // ... (same as before)
}

async function createSuperOpsTicket(onboardingData) {
  // ... (same as before)
}

// ======================= Main Handler =======================
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
    // Look at the last few messages to see if the user already chose
    // We'll check the last user message (if it contains "onboard" or "support")
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const lower = lastUserMsg.content.toLowerCase();
      if (lower === "onboard" || lower === "support") {
        intent = lower;
      }
    }
  }

  // If we still don't have an intent, use the router prompt to ask
  if (!intent) {
    try {
      // If there are no messages yet, start with the router prompt and ask the question.
      let completion;
      if (!messages || messages.length === 0) {
        // First interaction: just send the router question
        return res.json({
          action: "reply",
          message: "Hello! I'm Tech Johnny's assistant. Would you like to **onboard** a new user (collect workstation details) or **open a support ticket** (schedule a session with a technician)? Please reply with 'onboard' or 'support'."
        });
      } else {
        // There are messages, but we haven't determined intent yet. Let the router AI handle the conversation.
        completion = await openai.chat.completions.create({
          model: "gpt-4.1-mini",
          messages: [routerSystemPrompt, ...messages],
          functions: [], // no function calls in router
          function_call: "none",
        });
        const reply = completion.choices[0].message.content;
        return res.json({ action: "reply", message: reply });
      }
    } catch (err) {
      console.error("Router error:", err);
      return res.json({ action: "reply", message: "Sorry, I'm having trouble. Please try again." });
    }
  }

  // At this point, we have an intent: either "onboard" or "support"
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

      // Regular reply
      return res.json({ action: "reply", message: msg.content });
    } catch (err) {
      console.error("Unexpected onboarding error:", err);
      return res.json({ action: "reply", message: "Something went wrong during onboarding. Please try again." });
    }
  }

  // ======================= SUPPORT FLOW =======================
  // (Same as before, but now we know intent is "support")
  try {
    // Handle booking action (if sent by frontend)
    if (req.body.action === "book") {
      // ... (unchanged)
    }

    // Chat flow (no booking action)
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
