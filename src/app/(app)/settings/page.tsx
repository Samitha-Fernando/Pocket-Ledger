import { KeyRoundIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { ThemePicker } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db/client";
import { getUserDb } from "@/lib/auth/session";
import { centsToInput, formatDate, formatDateTime } from "@/lib/format";
import { signOutAction, switchUserAction } from "../../(auth)/actions";
import { removePin, revokeInvite } from "./actions";
import { AssetThresholdForm, AutoLockForm, InviteForm, LateIncomeForm, PasswordForm, PinForm } from "./forms";
import Link from "next/link";

export const metadata = { title: "Settings" };

const ACTION_LABELS: Record<string, string> = {
  account_created: "Account created",
  login: "Signed in",
  login_failed: "Failed sign-in attempt",
  unlock_pin: "Unlocked with PIN",
  unlock_password: "Unlocked with password",
  pin_failed: "Wrong PIN entered",
  pin_set: "PIN set",
  pin_changed: "PIN changed",
  pin_removed: "PIN removed",
  password_changed: "Password changed",
  sign_out: "Signed out",
  invite_created: "Invite created",
  invite_revoked: "Invite revoked",
  entry_created: "Transaction added",
  entry_updated: "Transaction edited",
  entry_deleted: "Transaction deleted",
  ledger_account_created: "Account added",
  ledger_account_renamed: "Account renamed",
  ledger_account_archived: "Account archived",
  ledger_account_unarchived: "Account unarchived",
  ledger_account_deleted: "Account deleted",
  asset_bought: "Asset bought",
  asset_converted_from_expense: "Expense converted to asset",
  asset_converted_to_expense: "Asset converted to expense",
  asset_updated: "Asset edited",
  asset_revalued: "Asset value changed",
  asset_revaluation_removed: "Asset value change removed",
  asset_sold: "Asset sold",
  asset_disposed: "Asset scrapped / given away",
  asset_sale_undone: "Asset sale undone",
  loan_created: "Money lent / invested",
  loan_updated: "Loan details edited",
  loan_lent_more: "Lent more",
  loan_money_back: "Money received back",
  loan_written_off: "Loan written off",
  loan_movement_deleted: "Loan money movement deleted",
  loan_deleted: "Loan deleted",
  debt_created: "Card / loan added",
  debt_updated: "Card / loan details edited",
  debt_payment: "Payment on card / loan",
  debt_borrowed: "Money borrowed",
  debt_charge: "Interest / fees charged",
  debt_movement_deleted: "Card / loan movement deleted",
  debt_deleted: "Card / loan deleted",
  import_uploaded: "Spreadsheet uploaded",
  import_posted: "Import posted",
  import_undone: "Import undone",
  import_deleted: "Import deleted",
};

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function inviteStatus(invite: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (invite.usedAt) return "Used";
  if (invite.revokedAt) return "Revoked";
  if (invite.expiresAt < new Date()) return "Expired";
  return "Waiting";
}

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { user, db } = await getUserDb();
  const { welcome } = await searchParams;

  // Activity comes through the user-scoped client: it can only ever return this user's rows.
  const activity = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 });
  const invites =
    user.role === "ADMIN"
      ? await prisma.invite.findMany({
          where: { createdById: user.id },
          include: { usedBy: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [];

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4">
        {welcome && !user.pinHash && (
          <div className="flex gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-primary" />
            <p>
              <strong>Welcome, {user.name}!</strong> Set a PIN below so you can unlock quickly on this
              device. The app locks itself after {user.autoLockMinutes} minutes without use.
            </p>
          </div>
        )}

        <Section title="Profile">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Name</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="break-all">{user.email}</dd>
            <dt className="text-muted-foreground">Username</dt>
            <dd>{user.username ?? "—"}</dd>
            <dt className="text-muted-foreground">Role</dt>
            <dd>{user.role === "ADMIN" ? "Admin" : "Member"}</dd>
            <dt className="text-muted-foreground">Currency</dt>
            <dd>{user.currency}</dd>
          </dl>
        </Section>

        <Section
          title="Quick-unlock PIN"
          description={
            user.pinHash
              ? "Your PIN is set. After 5 wrong PINs you'll need your password."
              : "Unlock with a 4–6 digit PIN instead of your full password."
          }
        >
          <div className="grid gap-4">
            <PinForm hasPin={Boolean(user.pinHash)} />
            {user.pinHash && (
              <form action={removePin}>
                <Button type="submit" variant="ghost" className="h-10 text-destructive">
                  Remove PIN
                </Button>
              </form>
            )}
          </div>
        </Section>

        <Section title="Auto-lock" description="Locks the app when you haven't used it for a while.">
          <AutoLockForm minutes={user.autoLockMinutes} />
        </Section>

        <Section
          title="Assets"
          description="When you add an expense this big or bigger, the app switches on &ldquo;Record as asset?&rdquo; for you. You can always change it per purchase."
        >
          <AssetThresholdForm value={centsToInput(user.assetThresholdCents)} />
        </Section>

        <Section
          title="Late income shift"
          description="If your salary arrives near the end of the month (e.g. the 25th), reports can count it as next month's money."
        >
          <LateIncomeForm day={user.lateIncomeDay} />
        </Section>

        <Section title="Import" description="Bring in your history from an Excel budget sheet.">
          <Button variant="outline" className="h-11" render={<Link href="/import" />} nativeButton={false}>
            Import from Excel
          </Button>
        </Section>

        <Section title="Appearance">
          <ThemePicker />
        </Section>

        <Section title="Password">
          <PasswordForm />
        </Section>

        <Section title="This device">
          <div className="grid gap-2 sm:grid-cols-2">
            <form action={switchUserAction}>
              <Button type="submit" variant="outline" className="h-11 w-full">
                Switch user
              </Button>
            </form>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" className="h-11 w-full">
                Sign out of this device
              </Button>
            </form>
          </div>
        </Section>

        {user.role === "ADMIN" && (
          <Section
            title="Invites"
            description="Only people with an invite code can create an account. Codes work once and expire after 7 days."
          >
            <div className="grid gap-5">
              <InviteForm />
              {invites.length > 0 && (
                <ul className="divide-y rounded-lg border text-sm">
                  {invites.map((invite) => {
                    const status = inviteStatus(invite);
                    return (
                      <li key={invite.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{invite.note ?? invite.email ?? "Invite"}</p>
                          <p className="text-xs text-muted-foreground">
                            Created {formatDate(invite.createdAt)}
                            {invite.usedBy && ` · used by ${invite.usedBy.name}`}
                          </p>
                        </div>
                        <span className="text-xs text-muted-foreground">{status}</span>
                        {status === "Waiting" && (
                          <form action={revokeInvite}>
                            <input type="hidden" name="id" value={invite.id} />
                            <Button type="submit" variant="ghost" size="sm" className="text-destructive">
                              Revoke
                            </Button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Section>
        )}

        <Section title="Recent security activity" description="Only you can see this.">
          <ul className="divide-y text-sm">
            {activity.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 py-2">
                <span>{ACTION_LABELS[entry.action] ?? entry.action}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </>
  );
}
