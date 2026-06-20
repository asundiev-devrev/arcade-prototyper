import { z } from "zod";

const slugRegex = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const frameSchema = z.object({
  slug: z.string().regex(slugRegex),
  name: z.string().min(1).max(120),
  createdAt: z.string(),
  size: z.enum(["375", "1024", "1440", "1920"]).default("1440"),
});
export type Frame = z.infer<typeof frameSchema>;

export const chimeInSchema = z.object({
  id: z.string(),
  /** Frame the objection is about; used for staleness auto-dismiss. */
  frameSlug: z.string(),
  /** Computer's concrete product-truth objection. */
  objection: z.string(),
  createdAt: z.string(),
  status: z.enum(["pending", "applied", "dismissed"]).default("pending"),
});
export type ChimeIn = z.infer<typeof chimeInSchema>;

export const projectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(slugRegex),
  createdAt: z.string(),
  updatedAt: z.string(),
  theme: z.enum(["arcade", "devrev-app"]),
  mode: z.enum(["light", "dark"]).default("light"),
  sessionId: z.string().optional(),
  computerConversationId: z.string().optional(),
  chimeIns: z.array(chimeInSchema).default([]),
  frames: z.array(frameSchema).default([]),
  deployments: z.array(z.object({
    frameSlug: z.string(),
    url: z.string(),
    createdAt: z.string(),
  })).optional(),
});
export type Project = z.infer<typeof projectSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  images: z.array(z.string()).optional(),
  // Which agent produced the message. Absent on older entries and on user
  // messages; defaults to "claude" at render time.
  source: z.enum(["claude", "computer"]).optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;
