import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { authApi } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import {
  PASSWORD_HINT,
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from "@/lib/validation";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: params.get("token") ?? "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    const token = params.get("token");
    if (token) form.setValue("token", token);
  }, [params, form]);

  async function onSubmit(values: ResetPasswordFormValues) {
    setSubmitting(true);
    try {
      const { data } = await authApi.confirmPasswordReset(
        values.token,
        values.newPassword,
      );
      toast.success(data.message ?? "Password updated. Sign in with the new password.");
      navigate("/auth/login", { replace: true });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Paste the reset token from email if it is not already in the address bar."
      footer={
        <p>
          <Link to="/auth/login" className="font-semibold text-teal hover:text-teal-bright">
            Return to sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Reset token" error={form.formState.errors.token?.message}>
          <TextInput {...form.register("token")} />
        </Field>
        <Field
          label="New password"
          hint={PASSWORD_HINT}
          error={form.formState.errors.newPassword?.message}
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            {...form.register("newPassword")}
          />
        </Field>
        <Field
          label="Confirm password"
          error={form.formState.errors.confirmPassword?.message}
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            {...form.register("confirmPassword")}
          />
        </Field>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
