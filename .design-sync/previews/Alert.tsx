import { Alert, AlertTitle, AlertDescription, AlertAction, Button, InfoIcon, TriangleAlertIcon } from 'pocket-ledger';

export const Info = () => (
  <Alert className="w-96">
    <InfoIcon />
    <AlertTitle>Import finished</AlertTitle>
    <AlertDescription>142 rows posted, 3 skipped as duplicates.</AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive" className="w-96">
    <TriangleAlertIcon />
    <AlertTitle>Backup failed</AlertTitle>
    <AlertDescription>The backup folder could not be reached. Check the drive and try again.</AlertDescription>
  </Alert>
);

export const WithAction = () => (
  <Alert className="w-96">
    <InfoIcon />
    <AlertTitle>3 entries need a category</AlertTitle>
    <AlertDescription>Review them before running reports.</AlertDescription>
    <AlertAction><Button size="xs" variant="outline">Review</Button></AlertAction>
  </Alert>
);
