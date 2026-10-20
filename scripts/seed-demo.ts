/**
 * Creates a SEPARATE demo database (data/demo.db) filled with fake people,
 * so you can record videos without showing your real finances.
 *
 *   npm run seed:demo   → (re)builds data/demo.db
 *   npm run dev:demo    → runs the app against the demo database
 *
 * Your real database (data/pocket-ledger.db) is never touched.
 * Later phases add fake accounts and transactions here.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const DEMO_URL = "file:./data/demo.db";

// Fake demo logins (documented in README).
export const DEMO_USERS = [
  { name: "Nimal Perera", email: "nimal@demo.test", username: "nimal", password: "demo-pass-1", pin: "2580", role: "ADMIN" as const },
  { name: "Kumari Perera", email: "kumari@demo.test", username: "kumari", password: "demo-pass-2", pin: "1470", role: "USER" as const },
];

async function main() {
  process.env.DATABASE_URL = DEMO_URL;

  mkdirSync("data", { recursive: true });
  for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(`data/demo.db${suffix}`, { force: true });
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: DEMO_URL }, stdio: "inherit" });

  // Import after DATABASE_URL is set so the client connects to the demo file.
  const { prisma } = await import("../src/lib/db/client");
  const { hashSecret } = await import("../src/lib/auth/crypto");
  const { scopedDb } = await import("../src/lib/db/scoped");
  const { ensureDefaultAccounts } = await import("../src/lib/ledger/accounts");
  const { saveEntry } = await import("../src/lib/ledger/engine");
  const { createAsset } = await import("../src/lib/ledger/assets");
  const { createLoan, receiveBack } = await import("../src/lib/ledger/loans");
  const { createDebt, makePayment, monthlyInterest } = await import("../src/lib/ledger/debts");
  const { shiftMonth, todayIso } = await import("../src/lib/format");

  for (const [index, u] of DEMO_USERS.entries()) {
    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        username: u.username,
        role: u.role,
        passwordHash: await hashSecret(u.password),
        pinHash: await hashSecret(u.pin),
      },
    });
    await prisma.auditLog.create({ data: { userId: user.id, action: "account_created", details: "Demo seed" } });
    // Kumari counts her salary (paid on the 25th) toward the next month, like the spreadsheet setting.
    if (index === 1) await prisma.user.update({ where: { id: user.id }, data: { lateIncomeDay: 25 } });

    // ---- Fake money: opening balances + ~3 months of everyday transactions ----
    const db = scopedDb(prisma, user.id);
    await ensureDefaultAccounts(db);
    const acc = Object.fromEntries((await db.account.findMany()).map((a) => [a.name, a.id]));
    const rand = seededRandom(index + 1);
    const rs = (rupees: number) => Math.round(rupees) * 100; // to cents
    const vary = (rupees: number, spread = 0.3) => rs(rupees * (1 - spread / 2 + rand() * spread));

    const today = todayIso();
    const start = shiftMonth(today.slice(0, 7), -3);
    const scale = index === 0 ? 1 : 0.7;

    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(15_000 * scale), accountId: acc["Cash in hand"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(240_000 * scale), accountId: acc["Bank account"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(650_000 * scale), accountId: acc["Savings account"] });
    await saveEntry(db, { kind: "OPENING_BALANCE", date: `${start}-01`, amount: rs(180_000 * scale), accountId: acc["AIA Emergency Fund"] });

    let count = 4;
    for (let m = 0; m <= 3; m++) {
      const month = shiftMonth(start, m);
      const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
      const add = async (input: Parameters<typeof saveEntry>[1]) => {
        if (input.date > today) return; // nothing in the future
        await saveEntry(db, input);
        count++;
      };
      const expense = (d: number, cat: string, amount: number, details: string, from = "Cash in hand") =>
        add({ kind: "EXPENSE", date: day(d), amount, categoryId: acc[cat], accountId: acc[from], details });

      await add({ kind: "INCOME", date: day(25), amount: rs(185_000 * scale), categoryId: acc["Employment (Net)"], accountId: acc["Bank account"], details: "Salary" });
      await add({ kind: "INCOME", date: day(28), amount: vary(2_400 * scale), categoryId: acc["Bank Interest"], accountId: acc["Savings account"], details: "Monthly interest" });
      await add({ kind: "TRANSFER", date: day(26), amount: rs(25_000 * scale), fromId: acc["Bank account"], toId: acc["Savings account"], details: "Monthly saving" });
      await add({ kind: "TRANSFER", date: day(27), amount: rs(5_000), fromId: acc["Bank account"], toId: acc["AIA Emergency Fund"], details: "AIA premium" });
      await add({ kind: "TRANSFER", date: day(3), amount: rs(40_000), fromId: acc["Bank account"], toId: acc["Cash in hand"], details: "ATM withdrawal" });
      await add({ kind: "TRANSFER", date: day(17), amount: rs(35_000), fromId: acc["Bank account"], toId: acc["Cash in hand"], details: "ATM withdrawal" });

      await expense(5, "Utilities", vary(6_800), "Electricity bill", "Bank account");
      await expense(6, "Utilities", vary(1_900), "Water bill", "Bank account");
      await expense(8, "Utilities", rs(3_499), "Mobile & internet", "Bank account");
      await expense(2, "Gym", rs(4_500), "Gym membership", "Bank account");
      for (const d of [4, 11, 18, 24]) await expense(d, "Groceries", vary(9_500 * scale), "Weekly groceries");
      for (const d of [2, 7, 9, 14, 16, 21, 23, 29]) await expense(d, "Food", vary(1_800), pick(rand, ["Lunch", "Kottu night", "Bakery", "Rice & curry"]));
      for (const d of [1, 10, 15, 20]) await expense(d, "Transportation", vary(3_200), pick(rand, ["Fuel", "PickMe ride", "Bus pass"]));
      if (m % 2 === 0) await expense(12, "Medicine", vary(2_600), "Pharmacy");
      if (m === 1) await expense(19, "Clothing", vary(12_000), "Office shirts", "Bank account");
      if (m === 2) await expense(13, "Fun & Vacation", vary(28_000 * scale), "Weekend in Ella", "Bank account");
      if (m === 2) await expense(22, "Gift", vary(5_000), "Birthday gift");
      await expense(14, "Body Care", vary(1_500), "Salon");
    }
    // ---- Fake assets, with repairs linked to them ----
    const day = (m: number, d: number) => `${shiftMonth(start, m)}-${String(d).padStart(2, "0")}`;
    const assets =
      index === 0
        ? [
            { name: "Honda Dio scooter", assetClass: "VEHICLES", date: day(0, 12), cost: 485_000, from: "Savings account", life: 96, residual: 120_000 },
            { name: "Samsung Galaxy phone", assetClass: "ELECTRONICS", date: day(1, 6), cost: 145_000, from: "Bank account", life: 36, residual: 0 },
          ]
        : [{ name: "Lenovo laptop", assetClass: "COMPUTERS", date: day(0, 20), cost: 235_000, from: "Savings account", life: 48, residual: 20_000 }];
    for (const a of assets) {
      const assetId = await createAsset(
        db,
        {
          name: a.name,
          assetClass: a.assetClass,
          purchaseDate: a.date,
          cost: rs(a.cost),
          fundingAccountId: acc[a.from],
          usefulLifeMonths: a.life,
          residualValue: rs(a.residual),
          notes: "Demo asset",
        },
        today,
      );
      if (a.assetClass === "VEHICLES") {
        for (const [m, d, amount, details] of [[1, 9, 6_500, "Full service"], [2, 21, 3_200, "New rear tyre"]] as const) {
          const date = day(m, d);
          if (date > today) continue;
          await saveEntry(db, {
            kind: "EXPENSE",
            date,
            amount: rs(amount),
            categoryId: acc["Assets Repairs & Maintenance"],
            accountId: acc["Cash in hand"],
            details,
            assetId,
          });
          count++;
        }
      }
    }
    // ---- Fake lending & investments ----
    const daysAgo = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - n);
      return d.toISOString().slice(0, 10);
    };
    let loanCount = 0;
    if (index === 0) {
      // Cheque exchange, interest kept up front: hand over 96,000, get 100,000 back (repaid).
      const kamal = await createLoan(
        db,
        {
          counterparty: "Kamal Silva",
          kind: "CHEQUE_EXCHANGE",
          startDate: daysAgo(50),
          dueDate: daysAgo(20),
          rateBasisPoints: 400,
          ratePeriod: "MONTH",
          interestAccountId: acc["Cheque Exchange Interest"],
          amount: rs(100_000),
          upfrontInterest: rs(4_000),
          fromAccountId: acc["Bank account"],
          notes: "Demo: cheque no. 004512",
        },
        today,
      );
      await receiveBack(db, kamal, { date: daysAgo(20), principal: rs(100_000), interest: 0, intoAccountId: acc["Bank account"] }, today);
      // Normal cheque exchange that's now overdue.
      await createLoan(
        db,
        {
          counterparty: "Ruwan Fernando",
          kind: "CHEQUE_EXCHANGE",
          startDate: daysAgo(40),
          dueDate: daysAgo(10),
          rateBasisPoints: 400,
          ratePeriod: "MONTH",
          interestAccountId: acc["Cheque Exchange Interest"],
          amount: rs(80_000),
          upfrontInterest: 0,
          fromAccountId: acc["Bank account"],
          notes: "Demo: post-dated cheque",
        },
        today,
      );
      // Fixed deposit paying interest monthly.
      const fdStart = day(0, 5);
      const fd = await createLoan(
        db,
        {
          counterparty: "Sampath Bank",
          kind: "FIXED_DEPOSIT",
          startDate: fdStart,
          dueDate: `${Number(fdStart.slice(0, 4)) + 1}${fdStart.slice(4)}`,
          rateBasisPoints: 900,
          ratePeriod: "YEAR",
          interestAccountId: acc["Bank Interest"],
          amount: rs(150_000),
          upfrontInterest: 0,
          fromAccountId: acc["Savings account"],
        },
        today,
      );
      for (let m = 1; m <= 3; m++) {
        const date = day(m, 5);
        if (date > today) continue;
        await saveEntry(db, { kind: "INCOME", date, amount: rs(1_125), categoryId: acc["Bank Interest"], accountId: acc["Savings account"], details: "FD interest", loanId: fd });
        count++;
      }
      loanCount = 3;
    } else {
      await createLoan(
        db,
        {
          counterparty: "Nirmala",
          kind: "PERSONAL_LOAN",
          startDate: daysAgo(10),
          dueDate: daysAgo(-20),
          rateBasisPoints: 0,
          ratePeriod: "MONTH",
          amount: rs(25_000),
          upfrontInterest: 0,
          fromAccountId: acc["Bank account"],
          notes: "Demo: school fees, no interest",
        },
        today,
      );
      loanCount = 1;
    }
    // ---- Fake credit card & loans you owe ----
    let debtCount = 0;
    if (index === 0) {
      const visa = await createDebt(
        db,
        {
          name: "Sampath Visa",
          lender: "Sampath Bank",
          kind: "CREDIT_CARD",
          startDate: `${start}-01`,
          rateBasisPoints: 2800,
          ratePeriod: "YEAR",
          creditLimit: rs(300_000),
          dueDay: 20,
          notes: "Demo card ending 4821",
          start: { type: "NONE" },
        },
        today,
      );
      const visaAccount = (await db.debt.findUniqueOrThrow({ where: { id: visa } })).accountId;
      for (let m = 0; m <= 3; m++) {
        let spent = 0;
        for (const [d, cat, amount, details] of [
          [8, "Groceries", 8_400, "Supermarket (card)"],
          [16, "Fun & Vacation", 6_900, "Dinner out (card)"],
          [22, "Clothing", 5_500, "Shoes (card)"],
        ] as const) {
          const date = day(m, d);
          if (date > today) continue;
          await saveEntry(db, { kind: "EXPENSE", date, amount: rs(amount), categoryId: acc[cat], accountId: visaAccount, details });
          spent += amount;
          count++;
        }
        // Pay last month's card bill in full on the 18th.
        const payDate = day(m + 1, 18);
        if (spent > 0 && payDate <= today) {
          await makePayment(db, visa, { date: payDate, principal: rs(spent), interest: 0, fromAccountId: acc["Bank account"], details: "Card bill" }, today);
          count++;
        }
      }
      await createDebt(
        db,
        {
          name: "Gold chain pawn",
          lender: "People's Bank",
          kind: "PAWNING",
          startDate: day(1, 10),
          rateBasisPoints: 1800,
          ratePeriod: "YEAR",
          notes: "Demo pawn ticket 7781",
          start: { type: "BORROW", amount: rs(120_000), fees: 0, intoAccountId: acc["Bank account"] },
        },
        today,
      );
      debtCount = 2;
    } else {
      const bankLoan = await createDebt(
        db,
        {
          name: "Personal loan",
          lender: "Commercial Bank",
          kind: "BANK_LOAN",
          startDate: `${start}-01`,
          rateBasisPoints: 1400,
          ratePeriod: "YEAR",
          dueDay: 5,
          monthlyPayment: rs(14_000),
          notes: "Demo: 24 instalments",
          start: { type: "ALREADY_OWE", amount: rs(280_000) },
        },
        today,
      );
      let owed = BigInt(rs(280_000));
      for (let m = 1; m <= 3; m++) {
        const date = day(m, 5);
        if (date > today) continue;
        const interest = monthlyInterest(owed, 1400, "YEAR");
        const principal = BigInt(rs(14_000)) - interest;
        await makePayment(
          db,
          bankLoan,
          { date, principal: Number(principal), interest: Number(interest), fromAccountId: acc["Bank account"], interestAccountId: acc["Interest Paid"], details: "Monthly instalment" },
          today,
        );
        owed -= principal;
        count++;
      }
      debtCount = 1;
    }
    // ---- Example rules (suggested on the Add form; can be applied to the past) ----
    if (index === 0) {
      const scooter = await db.fixedAsset.findFirst({ where: { name: "Honda Dio scooter" } });
      await db.rule.createMany({
        data: [
          { contains: "service", appliesTo: "EXPENSE", categoryId: acc["Assets Repairs & Maintenance"], assetId: scooter?.id ?? null },
          { contains: "fuel", appliesTo: "EXPENSE", categoryId: acc["Transportation"] },
        ] as never,
      });
    }
    console.log(`  ${u.name}: ${count} demo transactions, ${assets.length} asset(s), ${loanCount} loan(s), ${debtCount} debt(s)`);
  }

  await prisma.$disconnect();
  console.log("\nDemo database ready: data/demo.db");
  for (const u of DEMO_USERS) console.log(`  ${u.name.padEnd(14)} ${u.email.padEnd(18)} password: ${u.password}  PIN: ${u.pin}`);
  console.log("\nStart it with: npm run dev:demo\n");
}

/** Same "random" numbers every run, so demo videos look identical. */
function seededRandom(seed: number) {
  let s = seed * 2_654_435_761;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

function pick<T>(rand: () => number, items: T[]) {
  return items[Math.floor(rand() * items.length)];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
