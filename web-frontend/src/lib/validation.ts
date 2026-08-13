import { z } from "zod";

export const PASSWORD_HINT =
  "At least 8 characters, with uppercase, lowercase, and a number.";

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/,
    PASSWORD_HINT,
  );

export const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required").max(128),
});

export const registerBuyerSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(255),
    email: z.string().trim().email("Enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const registerDealerSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(255),
    email: z.string().trim().email("Enter a valid email address"),
    password: passwordSchema,
    confirmPassword: z.string(),
    dealerType: z.enum(["individual", "business"]),
    companyName: z
      .string()
      .trim()
      .min(2, "Company / trade name must be at least 2 characters")
      .max(255),
    businessAddress: z
      .string()
      .trim()
      .min(5, "Address must be at least 5 characters")
      .max(500),
    city: z.string().trim().min(2, "City is required").max(100),
    businessRegistrationNumber: z.string().trim().max(500).optional(),
    contactNumber: z
      .string()
      .trim()
      .optional()
      .refine(
        (value) => !value || /^\+?[1-9]\d{8,14}$/.test(value),
        "Use 9–15 digits, optionally starting with +",
      ),
    documentNote: z.string().trim().min(3, "Add a short note about your documents"),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine(
    (value) =>
      value.dealerType !== "business" ||
      Boolean(value.businessRegistrationNumber?.trim()),
    {
      message: "Business registration number is required for business dealers",
      path: ["businessRegistrationNumber"],
    },
  );

export const emailOnlySchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20, "Reset token is invalid"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginFormValues = z.infer<typeof loginSchema>;
export type RegisterBuyerFormValues = z.infer<typeof registerBuyerSchema>;
export type RegisterDealerFormValues = z.infer<typeof registerDealerSchema>;
export type EmailOnlyFormValues = z.infer<typeof emailOnlySchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
