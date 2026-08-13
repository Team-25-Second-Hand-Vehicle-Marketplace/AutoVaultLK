import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { RoleTabs } from "@/components/auth/RoleTabs";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea, TextInput } from "@/components/ui/Field";
import { authApi } from "@/lib/auth-api";
import { getApiErrorMessage } from "@/lib/api";
import {
  PASSWORD_HINT,
  registerDealerSchema,
  type RegisterDealerFormValues,
} from "@/lib/validation";

export function RegisterDealerPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<RegisterDealerFormValues>({
    resolver: zodResolver(registerDealerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      dealerType: "individual",
      companyName: "",
      businessAddress: "",
      city: "",
      businessRegistrationNumber: "",
      contactNumber: "",
      documentNote: "",
    },
  });
  const dealerType = useWatch({ control: form.control, name: "dealerType" });

  async function onSubmit(values: RegisterDealerFormValues) {
    setSubmitting(true);
    try {
      const { data } = await authApi.registerDealer({
        name: values.name,
        email: values.email,
        password: values.password,
        dealerType: values.dealerType,
        companyName: values.companyName,
        businessAddress: values.businessAddress,
        city: values.city,
        businessRegistrationNumber: values.businessRegistrationNumber || undefined,
        contactNumber: values.contactNumber || undefined,
        verificationDocuments: {
          note: values.documentNote,
          submittedVia: "web-frontend",
        },
      });
      toast.success(
        data.message ??
          "Registration received. Verify your email; an administrator must still approve the dealership.",
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
      title="Register a dealership"
      subtitle="Individual or business dealers can apply. You will verify email first; listings stay locked until an administrator approves you."
      footer={
        <p>
          Already applied?{" "}
          <Link to="/auth/login?role=dealer" className="font-semibold text-teal hover:text-teal-bright">
            Dealer sign in
          </Link>
        </p>
      }
    >
      <RoleTabs active="dealer" mode="register" />
      <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Contact name" error={form.formState.errors.name?.message}>
          <TextInput autoComplete="name" {...form.register("name")} />
        </Field>
        <Field label="Email" error={form.formState.errors.email?.message}>
          <TextInput type="email" autoComplete="email" {...form.register("email")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Password" hint={PASSWORD_HINT} error={form.formState.errors.password?.message}>
            <TextInput type="password" autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label="Confirm password" error={form.formState.errors.confirmPassword?.message}>
            <TextInput type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
          </Field>
        </div>
        <Field label="Dealer type" error={form.formState.errors.dealerType?.message}>
          <Select {...form.register("dealerType")}>
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </Select>
        </Field>
        <Field label="Company / trade name" error={form.formState.errors.companyName?.message}>
          <TextInput {...form.register("companyName")} />
        </Field>
        {dealerType === "business" ? (
          <Field
            label="Business registration number"
            error={form.formState.errors.businessRegistrationNumber?.message}
          >
            <TextInput {...form.register("businessRegistrationNumber")} />
          </Field>
        ) : null}
        <Field label="City" error={form.formState.errors.city?.message}>
          <TextInput {...form.register("city")} />
        </Field>
        <Field label="Business address" error={form.formState.errors.businessAddress?.message}>
          <TextArea {...form.register("businessAddress")} />
        </Field>
        <Field
          label="Contact number"
          hint="Optional. 9–15 digits, optionally starting with +."
          error={form.formState.errors.contactNumber?.message}
        >
          <TextInput {...form.register("contactNumber")} />
        </Field>
        <Field
          label="Verification documents note"
          hint="Describe NIC, BR, or showroom proof. File upload lands with the ingestion flow later."
          error={form.formState.errors.documentNote?.message}
        >
          <TextArea {...form.register("documentNote")} />
        </Field>
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? "Submitting…" : "Submit dealer registration"}
        </Button>
      </form>
    </AuthLayout>
  );
}
