import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { DemoAccounts } from "@/components/auth/DemoAccounts";
import { RoleTabs } from "@/components/auth/RoleTabs";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { useAuth } from "@/context/AuthContext";
import { getApiErrorMessage } from "@/lib/api";
import { dashboardPath } from "@/lib/roles";
import { loginSchema, type LoginFormValues } from "@/lib/validation";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const role = params.get("role") === "dealer" ? "dealer" : "buyer";
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginFormValues) {
    setSubmitting(true);
    try {
      const user = await login(values);
      toast.success("Welcome back.");
      navigate(dashboardPath(user.role), { replace: true });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title={role === "dealer" ? "Dealer sign in" : "Buyer sign in"}
      subtitle="Use the account you registered with. Administrators have a separate portal."
      footer={
        <p>
          New here?{" "}
          <Link
            to={
              role === "dealer"
                ? "/auth/register/dealer"
                : "/auth/register/buyer"
            }
            className="font-semibold text-teal hover:text-teal-bright"
          >
            Create an account
          </Link>
          {" · "}
          <Link to="/auth/login/admin" className="font-semibold text-teal hover:text-teal-bright">
            Admin portal
          </Link>
        </p>
      }
    >
      <RoleTabs active={role} mode="login" />
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <TextInput type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field label="Password" error={form.formState.errors.password?.message}>
          <TextInput
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
        </Field>
        <div className="flex justify-end">
          <Link to="/auth/forgot-password" className="text-xs font-medium text-muted hover:text-navy">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <div className="mt-6">
        <DemoAccounts variant="public" />
      </div>
    </AuthLayout>
  );
}
