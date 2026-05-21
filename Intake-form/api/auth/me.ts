import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireRole } from "../_lib/auth";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const auth = await requireRole(req, res, ["admin", "marketing"]);
  if (!auth) return;
  return res.status(200).json({
    email: auth.user.email,
    name: auth.user.name,
    role: auth.user.role,
  });
}
