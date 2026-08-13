import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DemoAccounts } from "@/components/auth/DemoAccounts";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { dashboardPath } from "@/lib/roles";
import { loginSchema, type LoginFormValues } from "@/lib/validation";

export function AdminLoginPage() {
  const { loginAdmin } = useAuth();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    setSubmitting(true);
    try {
      const user = await loginAdmin(values);
      toast.success("Administrator session started.");
      navigate(dashboardPath(user.role), { replace: true });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Administrator portal"
      subtitle="Staff accounts are seeded. This login is separate from buyer and dealer credentials."
      footer={
        <p>
          Not staff?{" "}
          <Link to="/auth/login" className="font-semibold text-teal hover:text-teal-bright">
            Go to public sign in
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Admin email" error={form.formState.errors.email?.message}>
          <TextInput type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <TextInput
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
        </Field>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Signing in…" : "Enter admin dashboard"}
        </Button>
      </form>
      <div className="mt-6">
        <DemoAccounts variant="admin" />
      </div>
    </AuthLayout>
  );
}
