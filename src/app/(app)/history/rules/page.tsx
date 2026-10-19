import Link from "next/link";
import { ChevronLeftIcon, PauseIcon, PlayIcon, Trash2Icon, WandSparklesIcon } from "lucide-react";
import { PageHeader } from "@/components/coming-soon";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLedger } from "@/lib/auth/session";
import { formatIsoDate } from "@/lib/format";
import { getFormData } from "@/lib/ledger/form-data";
import { previewRule } from "@/lib/ledger/rules";
import { cn } from "@/lib/utils";
import { applyRuleAction, deleteRuleAction, toggleRuleAction } from "../actions";
import { RuleForm } from "./rule-form";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const { user, db } = await getLedger();
  const [rules, data] = await Promise.all([db.rule.findMany({ orderBy: { createdAt: "desc" } }), getFormData(db, user.assetThresholdCents)]);
  const names = new Map<string, string>([
    ...[...data.expenseCategories, ...data.incomeCategories, ...data.payFrom].map((a) => [a.id, a.name] as [string, string]),
    ...data.fixedAssets.map((a) => [a.id, a.name] as [string, string]),
    ...data.loans.map((l) => [l.id, l.name] as [string, string]),
  ]);
  const previews = await Promise.all(rules.map((r) => previewRule(db, r)));

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/history" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="size-4" /> History
      </Link>
      <PageHeader
        title="Rules"
        description="“If the details contain … then …”. Apply a rule to past transactions with one click; for new ones it's suggested on the Add form (never applied without you)."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>New rule</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm
            categories={[
              ...data.expenseCategories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `${c.name} (expense)` })),
              ...data.incomeCategories.filter((c) => !c.archived).map((c) => ({ value: c.id, label: `${c.name} (income)` })),
            ]}
            assets={data.fixedAssets.filter((a) => a.active).map((a) => ({ value: a.id, label: a.name }))}
            loans={data.loans.filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }))}
            accounts={data.payFrom.filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }))}
          />
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
          <WandSparklesIcon className="mb-3 size-8" />
          No rules yet. Example: details contain “TW” → link to asset “Bike”.
        </div>
      ) : (
        <div className="grid gap-3">
          {rules.map((rule, i) => {
            const then = [
              rule.categoryId && `category → ${names.get(rule.categoryId) ?? "?"}`,
              rule.assetId && `link to ${names.get(rule.assetId) ?? "an asset"}`,
              rule.loanId && `link to ${names.get(rule.loanId) ?? "a loan"}`,
              rule.accountId && `account → ${names.get(rule.accountId) ?? "?"}`,
            ].filter(Boolean);
            const matches = previews[i];
            return (
              <Card key={rule.id} className={cn(!rule.active && "opacity-60")}>
                <CardHeader>
                  <CardTitle className="text-base">
                    If details contain “{rule.contains}”
                    {rule.appliesTo !== "ANY" && <span className="font-normal text-muted-foreground"> ({rule.appliesTo === "EXPENSE" ? "expenses" : "income"})</span>}
                  </CardTitle>
                  <CardDescription>Then {then.join(", ")}.{!rule.active && " (Paused: not suggested on new transactions.)"}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {matches.length > 0 ? (
                    <details className="rounded-lg border bg-muted/40 p-2 text-sm">
                      <summary className="cursor-pointer select-none">
                        Would change <strong>{matches.length}</strong> past transaction{matches.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
                        {matches.slice(0, 20).map((m) => (
                          <li key={m.id}>
                            {formatIsoDate(m.date)} · {m.details} · {m.categoryName}
                          </li>
                        ))}
                        {matches.length > 20 && <li>…and {matches.length - 20} more</li>}
                      </ul>
                    </details>
                  ) : (
                    <p className="text-sm text-muted-foreground">All matching past transactions already follow this rule.</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {matches.length > 0 && (
                      <form action={applyRuleAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <Button type="submit" className="h-10">
                          Apply to {matches.length} past transaction{matches.length === 1 ? "" : "s"}
                        </Button>
                      </form>
                    )}
                    <form action={toggleRuleAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <Button type="submit" variant="outline" className="h-10 gap-1.5">
                        {rule.active ? <PauseIcon /> : <PlayIcon />} {rule.active ? "Pause" : "Resume"}
                      </Button>
                    </form>
                    <form action={deleteRuleAction}>
                      <input type="hidden" name="ruleId" value={rule.id} />
                      <ConfirmButton message="Delete this rule? Transactions it already changed stay as they are.">
                        <Trash2Icon /> Delete
                      </ConfirmButton>
                    </form>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
