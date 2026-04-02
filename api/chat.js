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
  content: `You are a Tech Johnny assistant. The user must choose either "onboard" or "support". Ask them to type one of these two words. Do not ask for any other information or provide extra options. Keep your response short.`
};

const supportSystemPrompt = {
  role: "system",
  content: `You are a Tech Johnny support assistant. You must collect the following 8 pieces of information **one at a time**:
1. Name
2. Email
3. Company
4. Property (location or property name)
5. Issue description (ask once; ask for a concise summary including what happened, error messages, and steps taken)
6. Phone number
7. Restarted computer (Yes/No; if No, encourage restart before the call)
8. Session type (5min, 20min, 40min, 60min, nosub)

Do not ask for any additional information beyond these 8 items.

After you have collected all 8 details, **immediately call** the function submit_support_request with the collected data. Do not add any commentary, do not schedule anything yourself, and do not offer fake times. The system will handle the rest.

If a user asks to schedule without providing all details, continue asking for missing details. Never invent data.`
};

const onboardingSystemPrompt = {
  role: "system",
  content: `You are a Tech Johnny onboarding assistant. You must collect the following 28 workstation details **one at a time**:
- primary_work_location
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

Ask for each field individually, waiting for the user's response before moving to the next. Do not skip any field.

After you have collected all 28 details, **immediately call** the function submit_onboarding_request with the collected data. Do not add any summary, do not invent a reference number, and do not offer to proceed with setup. The system will create a ticket.`
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

// ======================= MAIN HANDLER =======================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ action: "reply", message: "Invalid request body" });
  }

  let { intent, messages } = req.body;

  if (!intent && messages?.length) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
    if (lastUserMsg) {
      const lower = lastUserMsg.content.trim().toLowerCase(); // FIX: trim safety
      if (lower === "onboard" || lower === "support") {
        intent = lower;
      }
    }
  }

  // ================= ROUTER =================
  if (!intent) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [routerSystemPrompt, ...messages],
    });

    return res.json({
      action: "reply",
      message: completion.choices[0].message.content,
    });
  }

  // ================= ONBOARD =================
  if (intent === "onboard") {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [onboardingSystemPrompt, ...messages],
      functions: onboardingFunctions,
      function_call: "auto",
    });

    const msg = completion.choices[0].message;

    if (msg.function_call?.name === "submit_onboarding_request") {
      let args = {};
      try {
        args = JSON.parse(msg.function_call.arguments);
      } catch (e) {
        console.error("Parse error:", e);
      }

      const ticket = await createSuperOpsTicket(args);

      return res.json({
        action: "reply",
        message: `Onboarding ticket created: ${ticket?.displayId || "SUCCESS"}`
      });
    }

    return res.json({ action: "reply", message: msg.content });
  }

  // ================= SUPPORT =================
  try {
    if (req.body.action === "book") {
      const { selectedTime, userData, fileLink } = req.body;

      const eventTypeUri = eventTypeMap[userData.session_type];

      let startTimeUtc = selectedTime;

      const invitee = {
        name: userData.name,
        email: userData.email,
        phone: userData.phone_number,
      };

      const customAnswers = buildCustomAnswers(userData.session_type, userData);

      if (fileLink) {
        const desc = customAnswers.find(a =>
          a.question.includes("Description") || a.question.includes("prepare")
        );
        if (desc) desc.answer += `\n\nAttachment: ${fileLink}`;
      }

      const booking = await bookCalendlyEvent(
        eventTypeUri,
        startTimeUtc,
        invitee,
        customAnswers,
        userData.session_type
      );

      return res.json({
        action: "link",
        url: booking.resource?.uri,
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [supportSystemPrompt, ...messages],
      functions: supportFunctions,
      function_call: "auto",
    });

    const msg = completion.choices[0].message;

    if (msg.function_call?.name === "submit_support_request") {
      const args = JSON.parse(msg.function_call.arguments || "{}");

      const eventTypeUri = eventTypeMap[args.session_type];

      const now = DateTime.now().setZone(TIMEZONE);
      const startTime = now.plus({ minutes: 1 });
      const endTime = now.plus({ days: 7 });

      const slots = await getCalendlySlots(eventTypeUri, startTime, endTime);

      return res.json({
        action: "slots",
        message: "Choose a time:",
        slots: slots?.slice(0, 8) || [],
        userData: args,
      });
    }

    return res.json({ action: "reply", message: msg.content });

  } catch (err) {
    console.error("Support flow error:", err);
    return res.json({ action: "reply", message: "Something went wrong." });
  }
}
