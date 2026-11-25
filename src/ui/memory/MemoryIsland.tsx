import { useEffect, useRef } from 'react';

/**
 * The memory surface host: mounts the non-React island once, keeps the host
 * node stable, and never leaves the island stranded. Mounted inside the
 * Settings · Memory tab; the surface looks identical to the old full-page tab
 * except for where it lives.
 */
export function MemoryIsland() {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    const memory = typeof window !== 'undefined'
      ? (window as unknown as { RamoMemory?: { open: () => Promise<void>; root?: HTMLElement | null } }).RamoMemory
      : undefined;
    if (!host || !memory) return;
    let alive = true;
    (async () => {
      try {
        await memory.open();
        if (!alive) return;
        // The island must live under this host, or the shell tears down or
        // duplicates it on tab unmounts.
        if (memory.root && memory.root.parentElement !== host) host.append(memory.root);
      } catch { /* memory tab degrades to an empty state */ }
    })();
    return () => { alive = false; };
  }, []);
  return <div ref={hostRef} className="oc-memory-host" data-oc-island="memory" />;
}
