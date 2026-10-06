"use client";

import { useActionState, useState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { login, register, setupAdmin, unlock } from "./actions";

function AccountFields() {
  return (
    <>
      <Field label="Your name" name="name" autoComplete="name" required />
      <Field label="Email" name="email" type="email" autoComplete="email" required />
      <Field
        label="Username (optional)"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        hint="You can sign in with either your email or username."
      />
      <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} required hint="At least 8 characters." />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
    </>
  );
}

export function SetupForm() {
  const [state, action] = useActionState(setupAdmin, undefined);
  return (
    <form action={action} className="grid gap-4">
      <AccountFields />
      <FormMessage state={state} />
      <SubmitButton>Create admin account</SubmitButton>
    </form>
  );
}

export function RegisterForm({ code }: { code: string }) {
  const [state, action] = useActionState(register, undefined);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Invite code" name="code" defaultValue={code} autoCapitalize="characters" placeholder="PL-XXXX-XXXX-XXXX" required />
      <AccountFields />
      <FormMessage state={state} />
      <SubmitButton>Create account</SubmitButton>
    </form>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <Field label="Email or username" name="identifier" autoComplete="username" autoCapitalize="none" required autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <FormMessage state={state} />
      <SubmitButton>Sign in</SubmitButton>
    </form>
  );
}

export function UnlockForm({ sessionId, canUsePin }: { sessionId?: string; canUsePin: boolean }) {
  const [state, action] = useActionState(unlock, undefined);
  const [method, setMethod] = useState<"pin" | "password">(canUsePin ? "pin" : "password");
  // After too many wrong PINs the server asks for the password instead,
  // and the PIN option stays hidden from then on.
  const [forcePassword, setForcePassword] = useState(false);
  if (state?.needPassword && !forcePassword) setForcePassword(true);
  const usePin = method === "pin" && !forcePassword;

  return (
    <form action={action} className="grid gap-4">
      {sessionId && <input type="hidden" name="sessionId" value={sessionId} />}
      <input type="hidden" name="method" value={usePin ? "pin" : "password"} />
      {usePin ? (
        <Field
          key="pin"
          label="PIN"
          name="secret"
          type="password"
          inputMode="numeric"
          pattern="\d{4,6}"
          maxLength={6}
          autoComplete="off"
          className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]"
          required
          autoFocus
        />
      ) : (
        <Field key="password" label="Password" name="secret" type="password" autoComplete="current-password" required autoFocus />
      )}
      <FormMessage state={state} />
      <SubmitButton>Unlock</SubmitButton>
      {canUsePin && !forcePassword && (
        <Button type="button" variant="ghost" className="h-11" onClick={() => setMethod(usePin ? "password" : "pin")}>
          {usePin ? "Use password instead" : "Use PIN instead"}
        </Button>
      )}
    </form>
  );
}
