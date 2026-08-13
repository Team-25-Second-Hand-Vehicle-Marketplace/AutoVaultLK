import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { authApi } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import { emailOnlySchema, type EmailOnlyFormValues } from "@/lib/validation";

export function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<EmailOnlyFormValues>({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: EmailOnlyFormValues) {
    setSubmitting(true);
    try {
      const { data } = await authApi.requestPasswordReset(values.email);
      toast.success(
        data.message ??
          "If an account exists for that email, reset instructions were sent.",
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We never confirm whether the email exists. If the account is eligible, instructions arrive in the inbox."
      footer={
        <p>
          Remembered it?{" "}
          <Link to="/auth/login" className="font-semibold text-teal hover:text-teal-bright">
            Back to sign in
          </Link>
          {" · "}
          <Link to="/auth/reset-password" className="font-semibold text-teal hover:text-teal-bright">
            I already have a token
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <TextInput type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Sending…" : "Send reset instructions"}
        </Button>
      </form>
    </AuthLayout>
  );
}
