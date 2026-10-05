import { cn } from '@/utils/cn';

interface AppLogoProps {
  className?: string;
}

/**
 * The single Travel Agency CRM product logo, served from `public/logo.png`.
 *
 * This is the ONLY logo used for Travel Agency CRM application branding (sidebar,
 * auth screens, favicon source). Tenant/company logos on custom domains are
 * separate business data and are unaffected.
 */
export function AppLogo({ className }: AppLogoProps) {
  return (
    <img
      src="/logo.png"
      alt="Travel Agency CRM"
      className={cn('block h-full w-full shrink-0 rounded-lg object-contain', className)}
    />
  );
}
