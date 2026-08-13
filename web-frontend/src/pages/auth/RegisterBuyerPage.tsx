import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { RoleTabs } from "@/components/auth/RoleTabs";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { authApi } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import {
  PASSWORD_HINT,
  registerBuyerSchema,
  type RegisterBuyerFormValues,
} from "@/lib/validation";

export function RegisterBuyerPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RegisterBuyerFormValues>({
    resolver: zodResolver(registerBuyerSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(values: RegisterBuyerFormValues) {
    setSubmitting(true);
    try {
      const { data } = await authApi.registerBuyer({
        name: values.name,
        email: values.email,
        password: values.password,
        deviceLabel: "web-frontend",
      });
      toast.success(
        data.message ?? "Check your inbox to verify your email before signing in.",
      );
      navigate("/auth/verify-email", {
        state: { email: values.email, token: data.verificationToken },
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create a buyer account"
      subtitle="Save favourites and return to listings you care about. Email verification is required before the first login."
      footer={
        <p>
          Already registered?{" "}
          <Link to="/auth/login" className="font-semibold text-teal hover:text-teal-bright">
            Sign in
          </Link>
        </p>
      }
    >
      <RoleTabs active="buyer" mode="register" />
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Full name" error={form.formState.errors.name?.message}>
          <TextInput autoComplete="name" {...form.register("name")} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <TextInput type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <Field
          label="Password"
          hint={PASSWORD_HINT}
          error={form.formState.errors.password?.message}
        >
          <TextInput
            type="password"
            autoComplete="new-password"
            {...form.register("password")}
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
          {submitting ? "Creating account…" : "Create buyer account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
