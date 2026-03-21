const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");   // ✅ ADD THIS
const app = express();
const PORT = 3000;

// Serve frontend
app.use(express.static("public"));

/**
 * 📌 Get available formats (clean JSON)
 */
app.get("/formats", (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send("URL is required");
  }

  const ytDlp = spawn("yt-dlp", ["--dump-single-json", url]);

  let data = "";

  ytDlp.stdout.on("data", (chunk) => {
    data += chunk.toString();
  });

  ytDlp.stderr.on("data", (err) => {
    console.error("yt-dlp error:", err.toString());
  });

  ytDlp.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).send("yt-dlp failed");
    }

    try {
      const json = JSON.parse(data);

      const formats = json.formats
        .filter(f => f.vcodec !== "none" && f.height)
        .map(f => ({
          format_id: f.format_id,
          quality: `${f.height}p`,
          height: f.height,
          ext: f.ext,
          hasAudio: f.acodec !== "none"
        }))
        .sort((a, b) => b.height - a.height);

      res.json(formats);
    } catch (err) {
      console.error("Parsing error:", err);
      console.log("RAW DATA:", data); // 🔥 debug
      res.status(500).send("Error parsing formats");
    }
  });
});
/**
 * 📌 Download video (smart handling)
 */
app.get("/download", (req, res) => {
  const { url, format, hasAudio } = req.query;

  if (!url || !format) {
    return res.status(400).send("URL and format are required");
  }

  const isAudioIncluded = hasAudio === "true";

  const formatString = isAudioIncluded
    ? format
    : `${format}+bestaudio`;

  const fileName = `video-${Date.now()}.mp4`;
  const filePath = path.join(__dirname, fileName);

  console.log("Downloading:", formatString);

  const ytDlp = spawn("yt-dlp", [
    "-f",
    formatString,
    "--merge-output-format",
    "mp4",
    "-o",
    filePath,
    url,
  ]);

  ytDlp.stderr.on("data", (data) => {
    console.log(data.toString());
  });

  ytDlp.on("close", (code) => {
    if (code !== 0) {
      return res.status(500).send("Download failed");
    }

    if (!fs.existsSync(filePath)) {
      return res.status(500).send("File not found");
    }

    // ✅ Force download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    res.sendFile(filePath, (err) => {
      if (err) console.error(err);

      // cleanup
      fs.unlink(filePath, () => {});
    });
  });
});
/**
 * 📌 Start server
 */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});