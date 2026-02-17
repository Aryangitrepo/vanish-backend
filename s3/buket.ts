import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import "dotenv/config";
import fs from "node:fs"; // 👈 add this
const { ACCOUNT_ID, ACCESS_KEY_ID, SECRET_KEY } = process.env;

export const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: `${ACCESS_KEY_ID}`,
    secretAccessKey: `${SECRET_KEY}`,
  },
});

export default async function Upload(userId, fileName, filePath) {
  const key = `${userId}/${fileName}`;
  const fileBuffer = fs.readFileSync(filePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: "vanish",
      Key: key,
      Body: fileBuffer,
    }),
  );
  console.log(`Uploaded ${key}`);
  return key;
}

export async function ListUserFiles(userId) {
  const response = await s3.send(
    new ListObjectsV2Command({
      Bucket: "vanish",
      Prefix: `${userId}/`, // Only fetch this user's files
    }),
  );

  return (response.Contents ?? []).map((obj) => ({
    key: obj.Key,
    fileName: obj.Key.replace(`${userId}/`, ""),
    size: obj.Size,
    lastModified: obj.LastModified,
    url: `/files/${obj.Key.replace(`${userId}/`, "")}`, // or a presigned URL
  }));
}
export async function DeleteUserFile(userId: string, fileName: string) {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: "vanish",
      Key: `${userId}/${fileName}`,
    }),
  );
}
