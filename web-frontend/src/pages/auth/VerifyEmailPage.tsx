import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, TextInput } from "@/components/ui/Field";
import { authApi } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import { emailOnlySchema } from "@/lib/validation";

const verifySchema = z.object({
  token: z.string().min(20, "Paste the full verification token"),
});

type VerifyForm = z.infer<typeof verifySchema>;

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const state = location.state as { email?: string; token?: string } | null;
  const [email, setEmail] = useState(state?.email ?? "");
  const [done, setDone] = useState(false);

  const verifyForm = useForm<VerifyForm>({
    resolver: zodResolver(verifySchema),
    defaultValues: { token: params.get("token") ?? state?.token ?? "" },
  });
  const resendForm = useForm({
    resolver: zodResolver(emailOnlySchema),
    defaultValues: { email: state?.email ?? "" },
  });

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      verifyForm.setValue("token", token);
    }
  }, [params, verifyForm]);

  async function onVerify(values: VerifyForm) {
    try {
      const { data } = await authApi.verifyEmail(values.token);
      toast.success(data.message ?? "Email verified. You can sign in now.");
      setDone(true);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  async function onResend(values: { email: string }) {
    try {
      const { data } = await authApi.resendVerification(values.email);
      setEmail(values.email);
      toast.success(data.message ?? "If the account exists, a new link was sent.");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle="Accounts stay inactive until this step is complete. Dealers then wait for administrator approval."
      footer={
        <p>
          Ready to continue?{" "}
          <Link to="/auth/login" className="font-semibold text-teal hover:text-teal-bright">
            Sign in
          </Link>
        </p>
      }
    >
      {done ? (
        <div className="rounded-2xl bg-white p-5 text-sm leading-relaxed text-muted ring-1 ring-line">
          Email verified. Sign in with your password. Dealers whose profiles are
          still pending will see that message at login until an admin approves them.
        </div>
      ) : (
        <form className="space-y-4" onSubmit={verifyForm.handleSubmit(onVerify)}>
          <Field label="Verification token" error={verifyForm.formState.errors.token?.message}>
            <TextInput {...verifyForm.register("token")} />
          </Field>
          <Button type="submit" fullWidth>
            Verify email
          </Button>
        </form>
      )}

      <div className="mt-10 border-t border-sand pt-6">
        <p className="mb-3 text-sm font-medium text-navy">Resend verification</p>
        <form className="space-y-3" onSubmit={resendForm.handleSubmit(onResend)}>
          <Field label="Email" error={resendForm.formState.errors.email?.message}>
            <TextInput type="email" {...resendForm.register("email")} />
          </Field>
          <Button type="submit" variant="ghost" fullWidth>
            Send a new link
          </Button>
        </form>
        {email ? (
          <p className="mt-3 text-xs text-muted">Last used: {email}</p>
        ) : null}
      </div>
    </AuthLayout>
  );
}
