import { google } from "googleapis";
import formidable from "formidable";
import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("Form parse error:", err);
      return res.status(500).json({ error: "File upload failed" });
    }

    const file = files.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // TEMPORARY: return the file object structure to see what we have
    // This will show us the keys in the response
    const fileInfo = {
      isArray: Array.isArray(file),
      keys: Object.keys(file),
      hasFilepath: !!file.filepath,
      hasPath: !!file.path,
      sample: file,
    };
    // Remove this block after debugging
    return res.status(500).json({ error: "Debug info", fileInfo });

    // The rest of the upload code is commented for now
    /*
    const filePath = file.filepath || file.path;
    if (!filePath) {
      console.error("No file path found in file object");
      return res.status(500).json({ error: "Invalid file object" });
    }

    try {
      if (!fs.existsSync(filePath)) {
        console.error("Temporary file does not exist:", filePath);
        return res.status(500).json({ error: "Temporary file missing" });
      }

      const fileStream = fs.createReadStream(filePath);
      const response = await drive.files.create({
        requestBody: {
          name: file.originalFilename || "upload.jpg",
          parents: ["root"],
        },
        media: {
          mimeType: file.mimetype,
          body: fileStream,
        },
        fields: "id,webViewLink",
      });

      await drive.permissions.create({
        fileId: response.data.id,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
      });

      fs.unlinkSync(filePath);

      return res.json({
        success: true,
        link: response.data.webViewLink,
      });
    } catch (error) {
      console.error("Drive upload error:", error);
      return res.status(500).json({ error: "Failed to upload to Drive" });
    }
    */
  });
}
