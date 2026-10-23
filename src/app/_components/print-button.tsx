"use client";

import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print voucher" }: { label?: string }) {
  return (
    <Button variant="outline" onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}
