import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useSettings, useUpdateBranding } from '@/features/settings/settings.api';
import {
  VOUCHER_DEFAULT_PRIMARY,
  isValidVoucherHex,
  voucherPreviewText,
} from '@/features/hotel-vouchers/voucher-branding';

/**
 * Relocated Hotel Voucher PDF branding control (moved from Settings →
 * Branding). Reuses the same saved setting (`hotelVoucherPrimaryColor`) and
 * the same persistence endpoint — only the control's location changed.
 */
export function VoucherBrandingControl({ canUpdate }: { canUpdate: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        aria-label="Voucher Branding Settings"
        title="Voucher Branding Settings"
        onClick={() => setOpen(true)}
      >
        <Settings className="h-4 w-4" aria-hidden="true" />
      </Button>
      {open && (
        <VoucherBrandingDialog canUpdate={canUpdate} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function VoucherBrandingDialog({
  canUpdate,
  onClose,
}: {
  canUpdate: boolean;
  onClose: () => void;
}) {
  const settings = useSettings();
  const branding = useUpdateBranding();
  const saved = settings.data?.branding.hotelVoucherPrimaryColor ?? null;
  const [color, setColor] = useState(VOUCHER_DEFAULT_PRIMARY);
  const [touched, setTouched] = useState(false);

  // Load the currently saved color when the dialog opens or data arrives.
  // Unsaved edits are never overwritten while the dialog stays open.
  useEffect(() => {
    if (!touched) setColor(saved ?? VOUCHER_DEFAULT_PRIMARY);
  }, [saved, touched]);

  const valid = isValidVoucherHex(color);
  const preview = valid ? color.trim().toLowerCase() : VOUCHER_DEFAULT_PRIMARY;

  const save = () => {
    if (!valid) return;
    branding.mutate(
      { hotelVoucherPrimaryColor: color.trim().toLowerCase() },
      { onSuccess: () => setTouched(false) },
    );
  };
  const resetDefault = () => {
    branding.mutate({ hotelVoucherPrimaryColor: null }, { onSuccess: () => setTouched(false) });
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Voucher branding"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Voucher Branding</h2>
          <button
            type="button"
            aria-label="Close voucher branding"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Primary color for hotel voucher section headers and accents. Leave the default purple
          unless this company needs its own theme.
        </p>
        {settings.isError ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Could not load branding settings.
          </p>
        ) : settings.data == null ? (
          <p className="mt-3 text-sm text-muted-foreground">Loading branding settings…</p>
        ) : (
          <>
            <div className="mt-3">
              <label htmlFor="voucher-branding-color" className="text-sm font-medium text-slate-700">
                Primary Color
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="voucher-branding-color"
                  aria-label="Voucher primary colour picker"
                  type="color"
                  value={preview}
                  disabled={!canUpdate}
                  onChange={(event) => {
                    setColor(event.target.value);
                    setTouched(true);
                  }}
                  className="h-9 w-12 rounded border"
                />
                <input
                  aria-label="Voucher primary colour hex"
                  className="w-full max-w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  value={color}
                  disabled={!canUpdate}
                  onChange={(event) => {
                    setColor(event.target.value);
                    setTouched(true);
                  }}
                  placeholder="#3d2352"
                />
              </div>
              {!valid && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  Enter a valid #RRGGBB colour.
                </p>
              )}
            </div>
            <div
              aria-label="Voucher colour preview"
              className="mt-3 overflow-hidden rounded-lg"
              style={{ backgroundColor: preview }}
            >
              <p
                className="px-3 py-2 text-sm font-bold tracking-wide"
                style={{ color: voucherPreviewText(preview) }}
              >
                HOTEL DETAILS
              </p>
            </div>
            {canUpdate && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button isLoading={branding.isPending} disabled={!valid} onClick={save}>
                  Save Color
                </Button>
                {saved != null && (
                  <Button variant="secondary" isLoading={branding.isPending} onClick={resetDefault}>
                    Reset to Default
                  </Button>
                )}
              </div>
            )}
          </>
        )}
        {branding.isSuccess && (
          <p role="status" className="mt-3 text-sm text-emerald-700">
            Voucher color saved. New PDFs will use it.
          </p>
        )}
        {branding.error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {branding.error.message}
          </p>
        )}
      </div>
    </div>
  );
}
