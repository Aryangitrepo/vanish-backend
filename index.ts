import express from "express";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import crypto from "node:crypto";
import { verifyToken } from "./firebase/auth.js";
import Upload from "./s3/buket.js";
import { ListUserFiles, DeleteUserFile } from "./s3/buket.js";
const app = express();
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const TEMP_DIR = path.join(UPLOAD_DIR, "temp");

// Ensure directories exist
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-upload-id",
      "content-range",
    ],
  }),
);

// 1. GET: Byte Serving Route
app.get("/files/:filename", (req, res) => {
  try {
    const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) return res.status(404).send("File not found");

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "application/octet-stream",
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "application/octet-stream",
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    res.status(500).send("Error serving file");
  }
});

// 2. POST: Initialize Upload
app.post("/upload/init", (req, res) => {
  try {
    const uploadId = crypto.randomUUID();
    console.log("✅ Init upload:", uploadId);
    res.json({ uploadId });
  } catch (error) {
    console.error("❌ Error initializing upload:", error);
    res.status(500).json({ error: "Failed to initialize upload" });
  }
});

// 3. POST: Upload Chunk
app.post(
  "/upload/chunk",
  verifyToken,
  express.raw({ type: "application/octet-stream", limit: "10mb" }),
  (req, res) => {
    try {
      const { "x-upload-id": uploadId, "content-range": range } = req.headers;
      const match = range?.match(/bytes (\d+)-/);

      if (!uploadId || !match) {
        return res.status(400).json({ error: "Invalid headers" });
      }

      const chunkDir = path.join(TEMP_DIR, uploadId as string);
      if (!fs.existsSync(chunkDir)) {
        fs.mkdirSync(chunkDir, { recursive: true });
      }

      const chunkPath = path.join(chunkDir, `chunk-${match[1]}`);
      fs.writeFileSync(chunkPath, req.body);

      res.sendStatus(200);
    } catch (error) {
      res.status(500).json({ error: "Failed to upload chunk" });
    }
  },
);

// 4. POST: Complete & Assemble
app.post("/upload/complete", express.json(), verifyToken, async (req, res) => {
  try {
    const { uploadId, fileName } = req.body;

    if (!uploadId || !fileName) {
      return res.status(400).json({ error: "Missing uploadId or fileName" });
    }

    const chunkDir = path.join(TEMP_DIR, uploadId);
    const safeName = path.basename(fileName);
    const finalPath = path.join(UPLOAD_DIR, safeName);

    if (!fs.existsSync(chunkDir)) {
      return res.status(400).json({ error: "Upload not found" });
    }

    const allFiles = fs.readdirSync(chunkDir);

    const chunks = allFiles
      .filter((f) => f.startsWith("chunk-"))
      .sort((a, b) => {
        const aNum = parseInt(a.split("-")[1], 10);
        const bNum = parseInt(b.split("-")[1], 10);
        return aNum - bNum;
      });

    if (chunks.length === 0) {
      return res.status(400).json({ error: "No chunks found" });
    }

    const writeStream = fs.createWriteStream(finalPath);
    let totalBytes = 0;

    for (const chunk of chunks) {
      const chunkPath = path.join(chunkDir, chunk);

      const data = fs.readFileSync(chunkPath);
      totalBytes += data.length;

      const canWrite = writeStream.write(data);
      if (!canWrite) {
        await new Promise((resolve) => writeStream.once("drain", resolve));
      }

      fs.unlinkSync(chunkPath);
    }

    await new Promise<void>((resolve, reject) => {
      writeStream.end(() => {
        resolve();
      });
      writeStream.on("error", (err) => {
        reject(err);
      });
    });

    // Inside /upload/complete, replace the Upload() call with:
    const userId = (req as any).user.uid;
    Upload(userId, safeName, finalPath)
      .then(() => {
        fs.unlinkSync(finalPath); // 👈 delete local file after successful S3 upload
        console.log(`🗑️ Deleted local file: ${safeName}`);
      })
      .catch((e) => {
        console.log(`error ${e}`);
      });

    fs.rmdirSync(chunkDir);

    res.json({
      message: "Complete",
      url: `/files/${safeName}`,
      fileName: safeName,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to complete upload",
      details: (error as Error).message,
    });
  }
});
app.get("/files", verifyToken, async (req, res) => {
  try {
    const userId = (req as any).user.uid; // uid attached by verifyToken middleware
    const files = await ListUserFiles(userId);
    res.json({ files });
  } catch (error) {
    console.error("❌ Error listing files:", error);
    res.status(500).json({ error: "Failed to list files" });
  }
});
app.delete("/files/:fileName", verifyToken, async (req, res) => {
  try {
    const userId = (req as any).user.uid;
    const fileName = decodeURIComponent(req.params.fileName);

    await DeleteUserFile(userId, fileName);

    res.json({ message: "File deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting file:", error);
    res.status(500).json({ error: "Failed to delete file" });
  }
});
app.listen(3000, () => console.log("🚀 Server running on port 3000"));
