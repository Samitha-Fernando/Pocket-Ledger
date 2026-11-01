import { useEffect } from 'react';
import { Toaster, toast } from 'pocket-ledger';

export const Toasts = () => {
  useEffect(() => {
    toast.success('Entry saved');
    toast.error('Could not reach the backup folder');
    toast('Budget updated', { description: 'October lines recalculated.' });
  }, []);
  return <Toaster expand position="top-center" duration={Infinity} />;
};
