"use client";

import Form from "next/form";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/form-controls";
import { SearchIcon } from "@/components/ui/icons";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

function getDetector(): BarcodeDetectorCtor | null {
  const w = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

const noop = () => () => {};
/** Camera scanning needs the BarcodeDetector API (Chrome, Edge, Android). Falls back to typing/pasting. */
function useScanSupported() {
  return useSyncExternalStore(
    noop,
    () => Boolean(getDetector() && navigator.mediaDevices?.getUserMedia),
    () => false,
  );
}

function Scanner({ onResult, onClose }: { onResult: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const Detector = getDetector();
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) {
              onResult(codes[0].rawValue);
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setError("The camera couldn't be opened. Allow camera access or type the reference instead.");
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : (
        <video ref={videoRef} className="aspect-square w-full rounded-lg bg-black object-cover" muted playsInline aria-label="Camera preview" />
      )}
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
    </div>
  );
}

/** Find a reservation by reference or a scanned/pasted voucher code; writes ?ref= to the URL. */
export function VoucherLookup({ defaultValue }: { defaultValue?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const canScan = useScanSupported();
  const [scanning, setScanning] = useState(false);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Form action={pathname} className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="lookup-ref" className="mb-1 block text-sm font-semibold text-ink">
            Reservation reference or voucher code
          </label>
          <Input id="lookup-ref" name="ref" defaultValue={defaultValue} placeholder="DE-7K3M9Q or scanned code" leading={<SearchIcon size={18} />} autoComplete="off" />
        </div>
        <Button type="submit">Find</Button>
      </Form>
      {canScan && (
        <>
          <Button variant="outline" onClick={() => setScanning(true)}>
            Scan QR code
          </Button>
          <Dialog open={scanning} onClose={() => setScanning(false)} title="Scan the pick-up voucher" size="sm">
            {scanning && (
              <Scanner
                onClose={() => setScanning(false)}
                onResult={(value) => {
                  setScanning(false);
                  router.push(`${pathname}?ref=${encodeURIComponent(value)}`);
                }}
              />
            )}
          </Dialog>
        </>
      )}
    </div>
  );
}
