"use client";

import { useActionState, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Field, FormMessage, SubmitButton } from "@/components/form-bits";
import { Button } from "@/components/ui/button";
import { changePassword, createInvite, setAutoLock, setPin } from "./actions";

export function PinForm({ hasPin }: { hasPin: boolean }) {
  const [state, action] = useActionState(setPin, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.success}>
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={hasPin ? "New PIN" : "PIN"} name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="off" hint="4 to 6 digits" required />
        <Field label="Confirm PIN" name="confirmPin" type="password" inputMode="numeric" pattern="\d{4,6}" maxLength={6} autoComplete="off" required />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="sm:w-auto">{hasPin ? "Change PIN" : "Set PIN"}</SubmitButton>
    </form>
  );
}

export function AutoLockForm({ minutes }: { minutes: number }) {
  const [state, action] = useActionState(setAutoLock, undefined);
  return (
    <form action={action} className="grid gap-4">
      <div className="flex items-end gap-3">
        <Field label="Lock after (minutes of inactivity)" name="minutes" type="number" min={1} max={120} defaultValue={minutes} className="flex-1" required />
        <SubmitButton className="w-auto">Save</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="grid gap-4" key={state?.success}>
      <Field label="Current password" name="currentPassword" type="password" autoComplete="current-password" required />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        <Field label="Confirm new password" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <FormMessage state={state} />
      <SubmitButton className="sm:w-auto">Change password</SubmitButton>
    </form>
  );
}

export function InviteForm() {
  const [state, action] = useActionState(createInvite, undefined);
  const [copied, setCopied] = useState(false);
  const link = state?.code ? `${window.location.origin}/register?code=${state.code}` : "";

  return (
    <div className="grid gap-4">
      <form action={action} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who is it for? (optional)" name="note" placeholder="e.g. My wife" />
          <Field label="Only this email can use it (optional)" name="email" type="email" />
        </div>
        <SubmitButton className="sm:w-auto">Create invite code</SubmitButton>
      </form>
      <FormMessage state={state} />
      {state?.code && (
        <div className="grid gap-2 rounded-lg border bg-muted/40 p-3">
          <p className="font-mono text-lg font-semibold tracking-wider">{state.code}</p>
          <p className="text-xs break-all text-muted-foreground">{link}</p>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-fit gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />} {copied ? "Copied" : "Copy sign-up link"}
          </Button>
        </div>
      )}
    </div>
  );
}
