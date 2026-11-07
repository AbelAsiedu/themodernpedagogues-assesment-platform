import { z } from "zod";
import { INSTITUTION_ROLES, PLATFORM_ROLES } from "./permissions.js";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Password policy for newly created/changed passwords (not applied to login attempts). */
export const newPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(256)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), "Use letters and numbers");

export const createUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2).max(120),
  password: newPasswordSchema,
  platformRole: z.enum(PLATFORM_ROLES).nullable().default(null),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const createInstitutionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens").min(2).max(60),
  country: z.string().trim().length(2).toUpperCase().default("GH"),
  timezone: z.string().trim().min(3).max(64).default("Africa/Accra"),
});
export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(INSTITUTION_ROLES),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const createClassSchema = z.object({
  name: z.string().trim().min(1).max(120),
  level: z.string().trim().min(1).max(40), // e.g. "JHS 3", "SHS 2"
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/, "e.g. 2026 or 2026/2027"),
});
export type CreateClassInput = z.infer<typeof createClassSchema>;

export const grantPermissionSchema = z.object({
  permission: z.string().min(3).max(64),
});
