import {
  Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter, Button,
} from 'pocket-ledger';

export const Summary = () => (
  <Card className="w-80">
    <CardHeader>
      <CardTitle>Net worth</CardTitle>
      <CardDescription>All accounts as of 01/11/2026</CardDescription>
      <CardAction><Button variant="outline" size="sm">Details</Button></CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-2xl font-semibold tabular-nums">$48,210.55</p>
      <p className="text-sm text-muted-foreground">+$1,320.10 this month</p>
    </CardContent>
  </Card>
);

export const WithFooter = () => (
  <Card className="w-80">
    <CardHeader>
      <CardTitle>October budget</CardTitle>
      <CardDescription>Spent $2,140 of $2,600</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="h-2 w-full rounded-full bg-muted">
        <div className="h-2 w-[82%] rounded-full bg-primary" />
      </div>
    </CardContent>
    <CardFooter className="justify-between text-muted-foreground">
      <span>$460 left</span>
      <Button variant="link" size="sm">Open budget</Button>
    </CardFooter>
  </Card>
);

export const Small = () => (
  <Card size="sm" className="w-64">
    <CardHeader>
      <CardTitle>Savings rate</CardTitle>
    </CardHeader>
    <CardContent><p className="text-xl font-semibold tabular-nums">23%</p></CardContent>
  </Card>
);
