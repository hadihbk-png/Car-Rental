import type { Metadata } from "next";
import { StatusPage } from "@/components/layout/status-page";
import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/ui/routes";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="We couldn't find that page"
      actions={
        <>
          <ButtonLink href={ROUTES.search}>Search cars</ButtonLink>
          <ButtonLink href={ROUTES.home} variant="outline">
            Go to home page
          </ButtonLink>
        </>
      }
    >
      The link may be out of date, or the reservation or vehicle no longer exists. Check the address or start a new search.
    </StatusPage>
  );
}
