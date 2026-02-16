import type { Request, Response, NextFunction } from "express";
import admin from "firebase-admin";
import serviceAccount from "./auth.json" with { type: "json" };

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}

export interface AuthRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

export const verifyToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const token = authHeader.split("Bearer ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Empty token" });
    }

    const decodedToken = await admin.auth().verifyIdToken(token);

    req.user = decodedToken;
    console.log("Auth successful for user:", decodedToken.uid);

    next();
  } catch (error) {
    console.error("Firebase Auth Error:", error);
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or expired token" });
  }
};
