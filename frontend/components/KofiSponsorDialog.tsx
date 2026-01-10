'use client';

import type { ReactElement } from 'react';
import { useSyncExternalStore } from 'react';

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

const KOFI_IFRAME_SRC = 'https://ko-fi.com/ornata/?hidefeed=true&widget=true&embed=true&preview=true';

let hydrated = false;
let hydrationScheduled = false;
const hydrationListeners = new Set<() => void>();

function scheduleHydrationUpdate(cb: () => void) {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(cb);
    return;
  }
  void Promise.resolve().then(cb);
}

function subscribeHydration(listener: () => void) {
  hydrationListeners.add(listener);
  if (!hydrated && !hydrationScheduled) {
    hydrationScheduled = true;
    scheduleHydrationUpdate(() => {
      hydrated = true;
      hydrationScheduled = false;
      hydrationListeners.forEach((l) => l());
    });
  }
  return () => hydrationListeners.delete(listener);
}

function getHydrationSnapshot() {
  return hydrated;
}

function getHydrationServerSnapshot() {
  return false;
}

export default function KofiSponsorDialog({ trigger }: { trigger: ReactElement }) {
  const isHydrated = useSyncExternalStore(subscribeHydration, getHydrationSnapshot, getHydrationServerSnapshot);
  if (!isHydrated) return trigger;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="p-0 sm:max-w-2xl w-[calc(100%-2rem)] max-h-[calc(100vh-2rem)] overflow-auto">
        <DialogTitle className="sr-only">Ko-fi sponsorship</DialogTitle>
        <iframe
          id="kofiframe"
          src={KOFI_IFRAME_SRC}
          style={{ border: 'none', width: '100%', padding: 4, background: '#f9f9f9' }}
          height={712}
          title="ornata"
        />
      </DialogContent>
    </Dialog>
  );
}
