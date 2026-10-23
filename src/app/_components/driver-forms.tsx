"use client";

import { useActionState, useEffect, useRef } from "react";
import { formatBytes } from "@/lib/ui/files";
import { formatDateTime } from "@/lib/ui/datetime";
import { IDLE, fieldError, type ActionState } from "@/app/_lib/action-state";
import { saveDriverProfileAction, uploadLicenceAction } from "@/app/profile/actions";
import { FileDropzone } from "@/components/forms/file-dropzone";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export interface DriverProfileValues {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  nationality: string;
  licenceNumber: string;
  licenceCountry: string;
  licenceIssuedOn: string | null;
  licenceExpiresOn: string;
}

function ResultNotice({ state }: { state: ActionState }) {
  if (state.status === "ok" && state.message) return <Notice tone="success" live>{state.message}</Notice>;
  if (state.status === "error")
    return (
      <Notice tone="error" live>
        {state.message}
      </Notice>
    );
  return null;
}

/** Driver details form (server action: upsertDriverProfile). */
export function DriverProfileForm({ profile, submitLabel = "Save driver details" }: { profile: DriverProfileValues | null; submitLabel?: string }) {
  const [state, action, pending] = useActionState(saveDriverProfileAction, IDLE);
  const err = (k: string) => fieldError(state, k);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <ResultNotice state={state} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField id="fullName" name="fullName" label="Full name (as on licence)" autoComplete="name" required defaultValue={profile?.fullName} error={err("fullName")} fieldClassName="sm:col-span-2" />
        <TextField id="phone" name="phone" type="tel" label="Mobile phone" autoComplete="tel" inputMode="tel" placeholder="+971 50 123 4567" required defaultValue={profile?.phone} error={err("phone")} />
        <TextField id="dateOfBirth" name="dateOfBirth" type="date" label="Date of birth" autoComplete="bday" required defaultValue={profile?.dateOfBirth} hint="Drivers must be 21 or older." error={err("dateOfBirth")} />
        <TextField id="nationality" name="nationality" label="Nationality" autoComplete="country-name" required defaultValue={profile?.nationality} error={err("nationality")} />
        <TextField id="licenceNumber" name="licenceNumber" label="Licence number" required defaultValue={profile?.licenceNumber} error={err("licenceNumber")} />
        <TextField id="licenceCountry" name="licenceCountry" label="Licence issued in (country)" required defaultValue={profile?.licenceCountry} error={err("licenceCountry")} />
        <TextField id="licenceIssuedOn" name="licenceIssuedOn" type="date" label="Licence issue date" optionalLabel defaultValue={profile?.licenceIssuedOn ?? ""} error={err("licenceIssuedOn")} />
        <TextField id="licenceExpiresOn" name="licenceExpiresOn" type="date" label="Licence expiry date" required defaultValue={profile?.licenceExpiresOn} hint="Must be valid for the whole rental." error={err("licenceExpiresOn")} />
      </div>
      <Button type="submit" loading={pending} loadingText="Saving…" className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}

export interface LicenceUploadFormProps {
  hasFile: boolean;
  uploadedAt: string | null;
  fileUrl: string | null;
  timeZone: string;
  accept: readonly string[];
  maxBytes: number;
}

/** Licence upload (server action: uploadLicence). Shows the current file with an authorised view link. */
export function LicenceUploadForm({ hasFile, uploadedAt, fileUrl, timeZone, accept, maxBytes }: LicenceUploadFormProps) {
  const [state, action, pending] = useActionState(uploadLicenceAction, IDLE);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <ResultNotice state={state} />
      {hasFile && (
        <p className="text-sm text-ink-muted">
          Licence on file{uploadedAt ? `, uploaded ${formatDateTime(uploadedAt, timeZone)}` : ""}.{" "}
          {fileUrl && (
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-700 hover:underline">
              View licence<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      )}
      <FileDropzone
        key={state.status === "ok" ? `done-${uploadedAt}` : "form"}
        name="licence"
        label={hasFile ? "Replace driving licence" : "Driving licence"}
        accept={accept}
        maxBytes={maxBytes}
        required={!hasFile}
        hint={`Photo or scan of the front of your licence. JPG, PNG, WebP or PDF, up to ${formatBytes(maxBytes)}.`}
        error={fieldError(state, "licence")}
      />
      <Button type="submit" variant={hasFile ? "outline" : "primary"} loading={pending} loadingText="Uploading…" className="self-start">
        {hasFile ? "Upload new licence" : "Upload licence"}
      </Button>
    </form>
  );
}
