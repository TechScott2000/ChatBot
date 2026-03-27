import { google } from "googleapis";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false, // required for file uploads
  },
};

// Separate OAuth2 client for Google Drive
const driveOAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_DRIVE_CLIENT_ID,
  process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  "https://developers.google.com/oauthplayground"
);

driveOAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
});

const drive = google.drive({ version: "v3", auth: driveOAuth2Client });

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const form = formidable({ multiples: false }); // single file
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).json({ error: "File upload failed" });
    }

    const file = files.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const fileStream = fs.createReadStream(file.filepath);
      const response = await drive.files.create({
        requestBody: {
          name: file.originalFilename || "upload.jpg",
          parents: ["root"], // Change to a specific folder ID if desired
        },
        media: {
          mimeType: file.mimetype,
          body: fileStream,
        },
        fields: "id,webViewLink",
      });

      // Make the file publicly accessible (anyone with the link can view)
      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      // Clean up temporary file
      fs.unlinkSync(file.filepath);

      return res.json({
        success: true,
        link: response.data.webViewLink,
      });
    } catch (error) {
      console.error("Drive upload error:", error);
      return res.status(500).json({ error: "Failed to upload to Drive" });
    }
  });
}
