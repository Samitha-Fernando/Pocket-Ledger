import { KeyRoundIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { ThemePicker } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db/client";
import { getUserDb } from "@/lib/auth/session";
import { centsToInput, formatDate, formatDateTime, formatMoney } from "@/lib/format";
import type { Snapshot } from "@/lib/ledger/history";
import { signOutAction, switchUserAction } from "../../(auth)/actions";
import { removePin, revokeInvite, toggleUserDisabledAction } from "./actions";
import {
  AssetThresholdForm,
  AutoLockForm,
  BackupFolderForm,
  BackupNowButton,
  CurrencyForm,
  InviteForm,
  LateIncomeForm,
  PasswordForm,
  PinForm,
  RestoreForm,
} from "./forms";
import { backupDir, copySubfolder, listBackups, readBackupSettings } from "@/lib/backup/local";
import { CURRENCIES } from "@/lib/currencies";
import { isEmptyAccount } from "@/lib/export/personal";
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
  bulk_edit: "Bulk change in History",
  rule_created: "Rule created",
  rule_applied: "Rule applied to past transactions",
  rule_deleted: "Rule deleted",
  backup_restored: "Backup restored",
  backup_made: "Backup made",
  backup_folder_set: "Backup folder changed",
  user_disabled: "Person disabled",
  user_enabled: "Person enabled",
  budget_imported: "Budgets imported",
  budget_year_copied: "Budget year copied",
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
  const emptyAccount = await isEmptyAccount(db);
  // Admin only: whole-app backups and the list of people.
  const isAdmin = user.role === "ADMIN";
  const [backups, backupSettings, people] = isAdmin
    ? await Promise.all([
        listBackups(),
        readBackupSettings(),
        prisma.user.findMany({
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            disabledAt: true,
            createdAt: true,
            sessions: { select: { lastActiveAt: true }, orderBy: { lastActiveAt: "desc" }, take: 1 },
          },
        }),
      ])
    : [[], { copyDir: null }, []];
  // Transactions removed recently (their edit history is kept even after deletion).
  const deleted = await db.entryChange.findMany({
    where: { action: { in: ["DELETE", "UNDO", "BULK", "CONVERT"] }, after: null },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
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

        <Section title="Currency" description="The symbol shown on amounts.">
          <CurrencyForm value={user.currency} options={CURRENCIES} />
        </Section>

        <Section title="Your data" description="Only your own data is included. Keep a backup somewhere safe; you can restore it later, e.g. on a server.">
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="h-11" render={<a href="/api/export/xlsx" download />} nativeButton={false}>
                Export to Excel
              </Button>
              <Button variant="outline" className="h-11" render={<a href="/api/export/csv" download />} nativeButton={false}>
                Export transactions (CSV)
              </Button>
              <Button variant="outline" className="h-11" render={<a href="/api/export/backup" download />} nativeButton={false}>
                Download my backup
              </Button>
            </div>
            {emptyAccount ? (
              <div className="grid gap-2 rounded-xl border p-3">
                <p className="text-sm font-medium">Restore a backup</p>
                <p className="text-xs text-muted-foreground">Your account is empty, so you can bring everything back from a backup file.</p>
                <RestoreForm />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Restoring a backup works into an empty account only (so nothing gets doubled).</p>
            )}
          </div>
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

        {isAdmin && (
          <Section
            title="Backups on this computer"
            description="A copy of everything (all people's data and photos) is made automatically each day when you open the app. The last 30 are kept."
          >
            <div className="grid gap-4 text-sm">
              <p>
                {backups[0] ? (
                  <>
                    Latest: <strong>{formatDateTime(backups[0].createdAt)}</strong> ({backups[0].reason.toLowerCase()}) · {backups.length} kept
                  </>
                ) : (
                  "No backups yet."
                )}
              </p>
              <p className="text-xs break-all text-muted-foreground">Saved in: {backupDir()}</p>
              {backupSettings.copyDir && (
                <p className="text-xs break-all text-muted-foreground">
                  Also copied to: {backupSettings.copyDir}\{copySubfolder}
                </p>
              )}
              <BackupNowButton />
              <BackupFolderForm value={backupSettings.copyDir ?? ""} />
              <p className="text-xs text-muted-foreground">
                Tip: install <strong>Google Drive for desktop</strong>, then enter its &ldquo;My Drive&rdquo; folder (usually <code>G:\My Drive</code>) so a
                copy is kept off this laptop too.
              </p>
            </div>
          </Section>
        )}

        {isAdmin && (
          <Section title="People" description="Disabled people can't sign in. Their data stays private and untouched; enable them again any time.">
            <ul className="divide-y text-sm">
              {people.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {p.name} {p.role === "ADMIN" && <span className="text-xs font-normal text-muted-foreground">(admin)</span>}
                      {p.disabledAt && <span className="text-xs font-normal text-destructive"> · disabled</span>}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.email} · joined {formatDate(p.createdAt)}
                      {p.sessions[0] && ` · last active ${formatDateTime(p.sessions[0].lastActiveAt)}`}
                    </span>
                  </span>
                  {p.id !== user.id && (
                    <form action={toggleUserDisabledAction}>
                      <input type="hidden" name="userId" value={p.id} />
                      <Button type="submit" variant="outline" size="sm" className={p.disabledAt ? "" : "text-destructive"}>
                        {p.disabledAt ? "Enable" : "Disable"}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

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

        {deleted.length > 0 && (
          <Section title="Recently deleted transactions" description="Kept for your records. What each one was, and when it was removed.">
            <ul className="divide-y text-sm">
              {deleted.map((c) => {
                const s = c.before ? (JSON.parse(c.before) as Snapshot) : null;
                const amount = s?.lines.filter((l) => BigInt(l.amount) > BigInt(0)).reduce((t, l) => t + BigInt(l.amount), BigInt(0)) ?? BigInt(0);
                return (
                  <li key={c.id} className="flex justify-between gap-4 py-2">
                    <span className="min-w-0">
                      <span className="block truncate">
                        {s ? `${s.date.split("-").reverse().join("/")} · ${s.details ?? s.kind.toLowerCase()} · ${formatMoney(amount, user.currency)}` : "Transaction"}
                      </span>
                      <span className="block text-xs text-muted-foreground">{c.summary}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(c.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
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
