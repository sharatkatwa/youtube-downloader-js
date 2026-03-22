const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
process.env.FFMPEG_PATH = ffmpegPath;
// Serve frontend
app.use(express.static("public"));

const ytdlp_path = fs.existsSync("/opt/render/.local/bin/yt-dlp") ? "/opt/render/.local/bin/yt-dlp" : "yt-dlp";
// const cookiesPath = path.join(__dirname, "cookies.txt");
const os = require("os");

// const cookiesPath = path.join(os.tmpdir(), "cookies.txt");
// const cookiesPath = "/etc/secrets/cookies.txt";
// fs.writeFileSync(cookiesPath, process.env.YT_COOKIES);
const secretCookiesPath = "/etc/secrets/cookies.txt";
const cookiesPath = path.join(os.tmpdir(), "cookies.txt");

// Copy cookies to writable location
if (fs.existsSync(secretCookiesPath)) {
  fs.copyFileSync(secretCookiesPath, cookiesPath);
} else {
  console.warn("⚠️ Secret cookies file not found");
}
/**
 * 📌 Get available formats (clean JSON)
 */
app.get("/formats", (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send("URL is required");
  }

  const ytDlp = spawn(ytdlp_path, [
    "--dump-single-json",
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "--cookies",
    cookiesPath,
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    url,
  ]);


  ytDlp.on("error", (err) => {
    console.error("Spawn error:", err);
  });
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
        .filter((f) => f.vcodec !== "none" && f.height)
        .map((f) => ({
          format_id: f.format_id,
          quality: `${f.height}p`,
          height: f.height,
          ext: f.ext,
          hasAudio: f.acodec !== "none",
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

  const formatString = isAudioIncluded ? format : `${format}+bestaudio`;

  const fileName = `video-${Date.now()}.mp4`;
  const filePath = path.join(__dirname, fileName);

  console.log("Downloading:", formatString);

  const ytDlp = spawn(ytdlp_path, [
    "--cookies",
    cookiesPath,
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
    "-f",
    formatString,
    "--merge-output-format",
    "mp4",
    "-o",
    filePath,
    url,
  ]);

  // 👇 PUT DEBUG HERE
  ytDlp.on("error", (err) => {
    console.error("Spawn error:", err);
  });

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
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

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
  console.log(`🚀 Server running on port ${PORT}`);
});
