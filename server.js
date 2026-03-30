const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

// FFmpeg setup
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
process.env.FFMPEG_PATH = ffmpegPath;

// Serve frontend
app.use(express.static("public"));

// yt-dlp path (Render + local)
const ytdlpPath = fs.existsSync("/opt/render/.local/bin/yt-dlp")
  ? "/opt/render/.local/bin/yt-dlp"
  : "yt-dlp";

// Cookies handling
const secretCookiesPath = "/etc/secrets/cookies.txt";
const localCookiesPath = path.join(__dirname, "cookies.txt");
const tempCookiesPath = path.join(os.tmpdir(), "cookies.txt");

let activeCookiesPath = null;
const formatCache = new Map();
const pendingFormatRequests = new Map();
const FORMAT_CACHE_TTL_MS = 10 * 60 * 1000;

if (fs.existsSync(secretCookiesPath)) {
  fs.copyFileSync(secretCookiesPath, tempCookiesPath);
  activeCookiesPath = tempCookiesPath;
} else if (fs.existsSync(localCookiesPath)) {
  activeCookiesPath = localCookiesPath;
} else if (fs.existsSync(tempCookiesPath)) {
  activeCookiesPath = tempCookiesPath;
} else {
  console.warn("No cookies file found");
}

function getYtDlpBaseArgs() {
  const args = [
    "--user-agent",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "--js-runtimes",
    "node",
    "--remote-components",
    "ejs:github",
  ];

  if (activeCookiesPath) {
    args.push("--cookies", activeCookiesPath);
  }

  return args;
}

function getErrorDetails(stderr) {
  return stderr.trim().split("\n").slice(-3).join("\n");
}

function normalizeFormats(formats) {
  return formats
    .filter(
      (format) =>
        format.vcodec !== "none" &&
        format.height &&
        format.acodec !== "none"
    )
    .map((format) => ({
      format_id: format.format_id,
      quality: `${format.height}p`,
      height: format.height,
      ext: format.ext,
      hasAudio: format.acodec !== "none",
    }))
    .sort((a, b) => a.height - b.height);
}

function getCachedFormats(url) {
  const cached = formatCache.get(url);

  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    formatCache.delete(url);
    return null;
  }

  return cached.data;
}

function setCachedFormats(url, data) {
  formatCache.set(url, {
    data,
    expiresAt: Date.now() + FORMAT_CACHE_TTL_MS,
  });
}

function fetchFormatsFromYtDlp(url) {
  return new Promise((resolve, reject) => {
    const ytDlp = spawn(ytdlpPath, [
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      ...getYtDlpBaseArgs(),
      url,
    ]);

    let data = "";
    let stderr = "";

    ytDlp.on("error", (err) => {
      console.error("Spawn error:", err);
      reject(err);
    });

    ytDlp.stdout.on("data", (chunk) => {
      data += chunk.toString();
    });

    ytDlp.stderr.on("data", (chunk) => {
      const message = chunk.toString();
      stderr += message;
      console.error("yt-dlp error:", message);
    });

    ytDlp.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(getErrorDetails(stderr) || "yt-dlp failed"));
      }

      try {
        const json = JSON.parse(data);
        resolve(normalizeFormats(json.formats || []));
      } catch (err) {
        console.error("Parsing error:", err);
        console.log("RAW DATA:", data);
        reject(new Error(getErrorDetails(stderr) || "Error parsing formats"));
      }
    });
  });
}

app.get("/formats", async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).send("URL is required");
  }

  const cachedFormats = getCachedFormats(url);

  if (cachedFormats) {
    return res.json(cachedFormats);
  }

  try {
    let pendingRequest = pendingFormatRequests.get(url);

    if (!pendingRequest) {
      pendingRequest = fetchFormatsFromYtDlp(url)
        .then((formats) => {
          setCachedFormats(url, formats);
          return formats;
        })
        .finally(() => {
          pendingFormatRequests.delete(url);
        });

      pendingFormatRequests.set(url, pendingRequest);
    }

    const formats = await pendingRequest;
    return res.json(formats);
  } catch (err) {
    return res.status(500).json({
      error: "yt-dlp failed",
      details: err.message,
    });
  }
});

app.get("/download", (req, res) => {
  const { url, format, ext } = req.query;

  if (!url || !format) {
    return res.status(400).send("Missing params");
  }

  console.log("Downloading:", url, format);

  const ytDlp = spawn(ytdlpPath, [
    ...getYtDlpBaseArgs(),
    "-f",
    format,
    "--concurrent-fragments",
    "8",
    "--no-part",
    "--no-cache-dir",
    "-o",
    "-",
    url,
  ]);

  let stderr = "";
  const safeExt = typeof ext === "string" && ext ? ext : "mp4";
  const contentType = safeExt === "webm" ? "video/webm" : "video/mp4";

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="video-${Date.now()}.${safeExt}"`
  );
  res.setHeader("Content-Type", contentType);

  ytDlp.stderr.on("data", (chunk) => {
    const message = chunk.toString();
    stderr += message;
    console.log(message);
  });

  ytDlp.stdout.pipe(res);

  ytDlp.on("error", (err) => {
    console.error("Spawn error:", err);

    if (!res.headersSent) {
      return res.status(500).send("Download failed");
    }

    res.destroy(err);
  });

  ytDlp.on("close", (code) => {
    if (code !== 0) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: "yt-dlp failed",
          details: getErrorDetails(stderr),
        });
      }

      return res.destroy(new Error(getErrorDetails(stderr) || "yt-dlp failed"));
    }

    res.end();
  });

  req.on("close", () => {
    if (!ytDlp.killed) {
      ytDlp.kill("SIGTERM");
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
